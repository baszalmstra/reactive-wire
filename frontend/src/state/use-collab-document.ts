import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as Y from "yjs";
import type { Edge } from "@xyflow/react";
import type { MacroMap } from "../../../shared/macros.js";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  applyEditorSnapshotDiff,
  decodeUpdateBase64,
  snapshotFromEditorDoc,
  snapshotFromEditorDocIncremental,
  type EditorDocumentSnapshot,
} from "../../../shared/collab.js";
import {
  editorSnapshotHasUserContent,
  editorSnapshotsEqual,
  reconciledSnapshotBaseline,
  snapshotFromWorkingState,
  workingStateFromSnapshot,
} from "./editor-document.js";
import type { EditorNode, Flow } from "../canvas/flows.js";
import type { Server } from "../server-conn.js";
import type { ToastMessage } from "../components/Toast.js";
import type { CanvasSnapshot } from "./use-undo-redo.js";

const collabServerOrigin = { source: "server" };
const collabLocalOrigin = { source: "local" };

export function useCollabDocument(options: {
  server: Server;
  flows: Flow[];
  setFlows: Dispatch<SetStateAction<Flow[]>>;
  activeFlowId: string;
  setActiveFlowId: Dispatch<SetStateAction<string>>;
  nodes: EditorNode[];
  edges: Edge[];
  nodesRef: MutableRefObject<EditorNode[]>;
  edgesRef: MutableRefObject<Edge[]>;
  macros: MacroMap;
  replaceMacros: (macros: MacroMap) => void;
  autoDeploy: boolean;
  setAutoDeploy: Dispatch<SetStateAction<boolean>>;
  deployedFlowIds: string[];
  setDeployedFlowIds: Dispatch<SetStateAction<string[]>>;
  setNodes: Dispatch<SetStateAction<EditorNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setPast: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  setFuture: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  showToast: (text: string, kind: ToastMessage["kind"]) => void;
  /** Test/operations instrumentation for detecting whole-working-state projections. */
  projectionStats?: { localSnapshots: number };
}): void {
  const {
    server,
    flows,
    setFlows,
    activeFlowId,
    setActiveFlowId,
    nodes,
    edges,
    nodesRef,
    edgesRef,
    macros,
    replaceMacros,
    autoDeploy,
    setAutoDeploy,
    deployedFlowIds,
    setDeployedFlowIds,
    setNodes,
    setEdges,
    setSelected,
    setSelectedIds,
    setPast,
    setFuture,
    showToast,
    projectionStats,
  } = options;
  const sendDocUpdate = server.sendDocUpdate;
  const acknowledgeDocReset = server.acknowledgeDocReset;

  const collabDoc = useRef<Y.Doc | null>(null);
  const [collabDocEpoch, setCollabDocEpoch] = useState(0);
  const getCollabDoc = useCallback((): Y.Doc => {
    if (!collabDoc.current) throw new Error("Collaborative document is not mounted");
    return collabDoc.current;
  }, []);
  // Allocate the Y.Doc only after React commits this hook. Render attempts discarded by StrictMode
  // or concurrent rendering therefore cannot leak live Yjs documents.
  useEffect(() => {
    const doc = new Y.Doc();
    collabDoc.current = doc;
    return () => {
      const current = collabDoc.current;
      collabDoc.current = null;
      collabReady.current = false;
      applyingCollab.current = false;
      lastCollabSnapshot.current = null;
      appliedDocStateNonce.current = null;
      appliedDocUpdateNonce.current = null;
      appliedDocResetNonce.current = null;
      if (current && current !== doc) current.destroy();
      doc.destroy();
    };
  }, []);
  const collabReady = useRef(false);
  const applyingCollab = useRef(false);
  const lastCollabSnapshot = useRef<EditorDocumentSnapshot | null>(null);
  const appliedDocStateNonce = useRef<number | null>(null);
  const appliedDocUpdateNonce = useRef<number | null>(null);
  const appliedDocResetNonce = useRef<number | null>(null);
  const localDirty = useRef(false);

  const replaceCollabDocument = useCallback((state: Uint8Array): Y.Doc => {
    const replacement = new Y.Doc();
    Y.applyUpdate(replacement, state, collabServerOrigin);
    const previous = collabDoc.current;
    collabDoc.current = replacement;
    previous?.destroy();
    setCollabDocEpoch((value) => value + 1);
    return replacement;
  }, []);

  const localDocumentSnapshot = useCallback((): EditorDocumentSnapshot => {
    if (projectionStats) projectionStats.localSnapshots += 1;
    return snapshotFromWorkingState({
      flows,
      activeFlowId,
      activeNodes: nodesRef.current,
      activeEdges: edgesRef.current,
      macros,
      autoDeploy,
      deployedFlowIds,
    });
  }, [activeFlowId, autoDeploy, deployedFlowIds, flows, macros, nodesRef, edgesRef, projectionStats]);

  const applyRemoteDocumentSnapshot = useCallback((snapshot: EditorDocumentSnapshot) => {
    applyingCollab.current = true;
    const previous = {
      flows,
      activeFlowId,
      activeNodes: nodesRef.current,
      activeEdges: edgesRef.current,
      macros,
      autoDeploy,
      deployedFlowIds,
    };
    const previousSnapshot = lastCollabSnapshot.current ?? undefined;
    const applied = workingStateFromSnapshot(snapshot, activeFlowId, previous, previousSnapshot);
    if (applied.flows !== flows) setFlows(applied.flows);
    if (applied.activeFlowId !== activeFlowId) setActiveFlowId(applied.activeFlowId);
    const activeGraphChanged = applied.activeNodes !== nodesRef.current || applied.activeEdges !== edgesRef.current;
    if (applied.activeNodes !== nodesRef.current) setNodes(applied.activeNodes);
    if (applied.activeEdges !== edgesRef.current) setEdges(applied.activeEdges);
    if (applied.macros !== macros) replaceMacros(applied.macros);
    if (applied.autoDeploy !== autoDeploy) setAutoDeploy(applied.autoDeploy);
    if (applied.deployedFlowIds !== deployedFlowIds) setDeployedFlowIds(applied.deployedFlowIds);
    if (activeGraphChanged) {
      const ids = new Set(applied.activeNodes.map((node) => node.id));
      setSelected((id) => (id && ids.has(id) ? id : null));
      setSelectedIds((selectedIds) => {
        const kept = selectedIds.filter((id) => ids.has(id));
        return kept.length === selectedIds.length ? selectedIds : kept;
      });
      setPast([]);
      setFuture([]);
    }
    // The incoming snapshot is already structurally shared by the incremental Yjs projection.
    // Keep it as the baseline instead of cloning every flow/node/edge back out of React state.
    // Template healing is written only alongside a later real local edit.
    lastCollabSnapshot.current = reconciledSnapshotBaseline(snapshot, applied, previousSnapshot);
    setTimeout(() => {
      applyingCollab.current = false;
    }, 0);
  }, [activeFlowId, autoDeploy, deployedFlowIds, edgesRef, flows, macros, nodesRef, replaceMacros, setFlows, setActiveFlowId, setEdges, setNodes, setAutoDeploy, setDeployedFlowIds, setSelected, setSelectedIds, setPast, setFuture]);

  const flushLocalDocumentToCollab = useCallback((allowBeforeReady = false) => {
    if ((!allowBeforeReady && !collabReady.current) || applyingCollab.current) return;
    if (!allowBeforeReady && !localDirty.current) return;
    const next = localDocumentSnapshot();
    if (allowBeforeReady && !collabReady.current && !editorSnapshotHasUserContent(next)) return;
    if (editorSnapshotsEqual(lastCollabSnapshot.current, next)) {
      localDirty.current = false;
      return;
    }
    const doc = getCollabDoc();
    const previous = lastCollabSnapshot.current ?? snapshotFromEditorDoc(doc);
    applyEditorSnapshotDiff(doc, previous, next, collabLocalOrigin);
    lastCollabSnapshot.current = snapshotFromEditorDoc(doc);
    localDirty.current = false;
  }, [localDocumentSnapshot, getCollabDoc]);

  const sendLocalUpdatesMissingFromServerState = useCallback((serverState: Uint8Array) => {
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, serverState);
    const missing = Y.encodeStateAsUpdate(getCollabDoc(), Y.encodeStateVector(serverDoc));
    // Yjs encodes an empty diff as [0, 0]. Anything larger contains local/offline edits the
    // server has not seen yet, so upload it after reconnecting instead of silently diverging.
    if (missing.length > 2) sendDocUpdate(missing);
    serverDoc.destroy();
  }, [sendDocUpdate, getCollabDoc]);

  useEffect(() => {
    const doc = getCollabDoc();
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === collabServerOrigin || !collabReady.current) return;
      sendDocUpdate(update);
    };
    doc.on("update", onUpdate);
    return () => doc.off("update", onUpdate);
  }, [sendDocUpdate, getCollabDoc, collabDocEpoch]);

  useEffect(() => {
    if (!server.docState || appliedDocStateNonce.current === server.docState.nonce) return;
    appliedDocStateNonce.current = server.docState.nonce;
    try {
      flushLocalDocumentToCollab(true);
      const update = decodeUpdateBase64(server.docState.update, DEFAULT_MAX_DOC_STATE_BYTES);
      const doc = getCollabDoc();
      Y.applyUpdate(doc, update, collabServerOrigin);
      sendLocalUpdatesMissingFromServerState(update);
      collabReady.current = true;
      // applyRemoteDocumentSnapshot sets the diff baseline to the reconciled projection it renders.
      applyRemoteDocumentSnapshot(snapshotFromEditorDoc(doc));
    } catch (err) {
      showToast(`Document sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [server.docState, applyRemoteDocumentSnapshot, flushLocalDocumentToCollab, sendLocalUpdatesMissingFromServerState, showToast, getCollabDoc]);

  useEffect(() => {
    if (!server.docUpdate || appliedDocUpdateNonce.current === server.docUpdate.nonce) return;
    appliedDocUpdateNonce.current = server.docUpdate.nonce;
    try {
      // Preserve any local edit waiting in the debounce window before rendering the remote update;
      // otherwise a remote packet can replace unsent local React state and cause data loss.
      flushLocalDocumentToCollab();
      const doc = getCollabDoc();
      let appliedTransaction: Y.Transaction | null = null;
      const capture = (transaction: Y.Transaction) => {
        if (transaction.origin === collabServerOrigin) appliedTransaction = transaction;
      };
      doc.on("afterTransaction", capture);
      try {
        Y.applyUpdate(doc, decodeUpdateBase64(server.docUpdate.update), collabServerOrigin);
      } finally {
        doc.off("afterTransaction", capture);
      }
      const previous = lastCollabSnapshot.current;
      applyRemoteDocumentSnapshot(previous && appliedTransaction
        ? snapshotFromEditorDocIncremental(doc, previous, appliedTransaction)
        : snapshotFromEditorDoc(doc));
    } catch (err) {
      showToast(`Document sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [server.docUpdate, applyRemoteDocumentSnapshot, flushLocalDocumentToCollab, showToast, getCollabDoc]);

  useEffect(() => {
    if (!server.docReset || appliedDocResetNonce.current === server.docReset.nonce) return;
    appliedDocResetNonce.current = server.docReset.nonce;
    try {
      collabReady.current = false;
      applyingCollab.current = true;
      localDirty.current = false;
      const state = decodeUpdateBase64(server.docReset.update, DEFAULT_MAX_DOC_STATE_BYTES);
      const doc = replaceCollabDocument(state);
      const snapshot = snapshotFromEditorDoc(doc);
      // The old baseline belongs to the contaminated Y.Doc; force a true replacement projection.
      lastCollabSnapshot.current = null;
      applyRemoteDocumentSnapshot(snapshot);
      collabReady.current = true;
      acknowledgeDocReset(server.docReset.generation);
      showToast(`Document sync reset after persistence failure: ${server.docReset.error}`, "error");
    } catch (err) {
      showToast(`Document reset failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [server.docReset, acknowledgeDocReset, applyRemoteDocumentSnapshot, replaceCollabDocument, showToast]);

  useEffect(() => {
    if (!server.docError) return;
    showToast(`Document sync failed: ${server.docError}`, "error");
  }, [server.docError, showToast]);

  useEffect(() => {
    if (!collabReady.current || applyingCollab.current) return;
    localDirty.current = true;
    const timer = setTimeout(() => flushLocalDocumentToCollab(), 180);
    return () => clearTimeout(timer);
  }, [nodes, edges, flows, activeFlowId, macros, autoDeploy, deployedFlowIds, flushLocalDocumentToCollab]);
}
