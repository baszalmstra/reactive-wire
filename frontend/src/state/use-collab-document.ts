import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as Y from "yjs";
import type { Edge } from "@xyflow/react";
import type { MacroMap } from "../../../shared/macros.js";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  applyEditorSnapshotDiff,
  decodeUpdateBase64,
  snapshotFromEditorDoc,
  type EditorDocumentSnapshot,
} from "../../../shared/collab.js";
import {
  editorSnapshotHasUserContent,
  editorSnapshotsEqual,
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
  setNodes: Dispatch<SetStateAction<EditorNode[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setPast: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  setFuture: Dispatch<SetStateAction<CanvasSnapshot[]>>;
  showToast: (text: string, kind: ToastMessage["kind"]) => void;
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
    setNodes,
    setEdges,
    setSelected,
    setSelectedIds,
    setPast,
    setFuture,
    showToast,
  } = options;

  const collabDoc = useRef(new Y.Doc());
  const collabReady = useRef(false);
  const applyingCollab = useRef(false);
  const lastCollabSnapshot = useRef<EditorDocumentSnapshot | null>(null);
  const appliedDocStateNonce = useRef<number | null>(null);
  const appliedDocUpdateNonce = useRef<number | null>(null);

  const localDocumentSnapshot = useCallback((): EditorDocumentSnapshot => snapshotFromWorkingState({
    flows,
    activeFlowId,
    activeNodes: nodesRef.current,
    activeEdges: edgesRef.current,
    macros,
    autoDeploy,
  }), [activeFlowId, autoDeploy, flows, macros, nodesRef, edgesRef]);

  const applyRemoteDocumentSnapshot = useCallback((snapshot: EditorDocumentSnapshot) => {
    applyingCollab.current = true;
    const applied = workingStateFromSnapshot(snapshot, activeFlowId);
    setFlows(applied.flows);
    setActiveFlowId(applied.activeFlowId);
    setNodes(applied.activeNodes);
    setEdges(applied.activeEdges);
    replaceMacros(applied.macros);
    setAutoDeploy(applied.autoDeploy);
    setSelected((id) => (id && applied.activeNodes.some((node) => node.id === id) ? id : null));
    setSelectedIds((ids) => ids.filter((id) => applied.activeNodes.some((node) => node.id === id)));
    setPast([]);
    setFuture([]);
    queueMicrotask(() => {
      applyingCollab.current = false;
    });
  }, [activeFlowId, replaceMacros, setFlows, setActiveFlowId, setEdges, setNodes, setAutoDeploy, setSelected, setSelectedIds, setPast, setFuture]);

  const flushLocalDocumentToCollab = useCallback((allowBeforeReady = false) => {
    if ((!allowBeforeReady && !collabReady.current) || applyingCollab.current) return;
    const next = localDocumentSnapshot();
    if (allowBeforeReady && !collabReady.current && !editorSnapshotHasUserContent(next)) return;
    if (editorSnapshotsEqual(lastCollabSnapshot.current, next)) return;
    const previous = lastCollabSnapshot.current ?? snapshotFromEditorDoc(collabDoc.current);
    applyEditorSnapshotDiff(collabDoc.current, previous, next, collabLocalOrigin);
    lastCollabSnapshot.current = snapshotFromEditorDoc(collabDoc.current);
  }, [localDocumentSnapshot]);

  const sendLocalUpdatesMissingFromServerState = useCallback((serverState: Uint8Array) => {
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, serverState);
    const missing = Y.encodeStateAsUpdate(collabDoc.current, Y.encodeStateVector(serverDoc));
    // Yjs encodes an empty diff as [0, 0]. Anything larger contains local/offline edits the
    // server has not seen yet, so upload it after reconnecting instead of silently diverging.
    if (missing.length > 2) server.sendDocUpdate(missing);
    serverDoc.destroy();
  }, [server.sendDocUpdate]);

  useEffect(() => {
    const doc = collabDoc.current;
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === collabServerOrigin || !collabReady.current) return;
      server.sendDocUpdate(update);
    };
    doc.on("update", onUpdate);
    return () => doc.off("update", onUpdate);
  }, [server.sendDocUpdate]);

  useEffect(() => {
    if (!server.docState || appliedDocStateNonce.current === server.docState.nonce) return;
    appliedDocStateNonce.current = server.docState.nonce;
    try {
      flushLocalDocumentToCollab(true);
      const update = decodeUpdateBase64(server.docState.update, DEFAULT_MAX_DOC_STATE_BYTES);
      Y.applyUpdate(collabDoc.current, update, collabServerOrigin);
      sendLocalUpdatesMissingFromServerState(update);
      const snapshot = snapshotFromEditorDoc(collabDoc.current);
      lastCollabSnapshot.current = snapshot;
      collabReady.current = true;
      applyRemoteDocumentSnapshot(snapshot);
    } catch (err) {
      showToast(`Document sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [server.docState, applyRemoteDocumentSnapshot, flushLocalDocumentToCollab, sendLocalUpdatesMissingFromServerState, showToast]);

  useEffect(() => {
    if (!server.docUpdate || appliedDocUpdateNonce.current === server.docUpdate.nonce) return;
    appliedDocUpdateNonce.current = server.docUpdate.nonce;
    try {
      // Preserve any local edit waiting in the debounce window before rendering the remote update;
      // otherwise a remote packet can replace unsent local React state and cause data loss.
      flushLocalDocumentToCollab();
      Y.applyUpdate(collabDoc.current, decodeUpdateBase64(server.docUpdate.update), collabServerOrigin);
      const snapshot = snapshotFromEditorDoc(collabDoc.current);
      lastCollabSnapshot.current = snapshot;
      applyRemoteDocumentSnapshot(snapshot);
    } catch (err) {
      showToast(`Document sync failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  }, [server.docUpdate, applyRemoteDocumentSnapshot, flushLocalDocumentToCollab, showToast]);

  useEffect(() => {
    if (!server.docError) return;
    showToast(`Document sync failed: ${server.docError}`, "error");
  }, [server.docError, showToast]);

  useEffect(() => {
    if (!collabReady.current || applyingCollab.current) return;
    const timer = setTimeout(() => flushLocalDocumentToCollab(), 180);
    return () => clearTimeout(timer);
  }, [nodes, edges, flows, activeFlowId, macros, flushLocalDocumentToCollab]);
}
