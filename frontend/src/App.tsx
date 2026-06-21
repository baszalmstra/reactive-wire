import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import * as Y from "yjs";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectStartParams,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildThemeVars, gridStyle, TYPE_VAR, type Aesthetic, type Mode } from "../../shared/theme.js";
import { cn } from "./cn.js";
import { evaluate, type Memory, type ViewEdge } from "../../shared/engine/evaluate.js";
import { simulate } from "./example/sim.js";
import { nodeGeom, type NodeData } from "../../shared/node-types.js";
import type { EntityMap } from "../../shared/entities.js";
import { entityStateType } from "../../shared/value.js";
import { initialNodes, initialEdges } from "./example/rf-graph.js";
import { RWNode } from "./canvas/RWNode.js";
import { Inspector } from "./canvas/Inspector.js";
import { Palette } from "./canvas/Palette.js";
import { NodeConfigPopup } from "./canvas/NodeConfigPopup.js";
import { PALETTE, growVariadic, type NodeTemplate, type RequiredConfig } from "./canvas/node-templates.js";
import { ResultsProvider } from "./canvas/results-context.js";
import { connectionReason, connectionValid, edgeStyle, type RWNodeType } from "./canvas/validation.js";
import { CommentNode } from "./canvas/CommentNode.js";
import { CommentCtx, type CommentOps } from "./canvas/comments-context.js";
import {
  COMMENT_COLOR_KEYS,
  nodeCenterInside,
  resizeFrame,
  type CommentColor,
  type CommentData,
  type CommentNodeType,
  type ResizeDir,
} from "./canvas/comments.js";
import { MobileBar } from "./components/MobileBar.js";
import { useIsMobile } from "./use-is-mobile.js";
import { useMacros, syncInstance } from "./canvas/use-macros.js";
import { groupSelection } from "./canvas/grouping.js";
import { isMacroInstance, makeMacroInstance, type MacroDef, type MacroMap } from "../../shared/macros.js";
import { MacroEditor } from "./canvas/MacroEditor.js";
import { MacroList } from "./canvas/MacroList.js";
import { useServer } from "./server-conn.js";
import { deriveProblems, problemCounts } from "./canvas/problems.js";
import { ProblemsPanel } from "./components/ProblemsPanel.js";
import { Banner } from "./components/Banner.js";
import { Toast, type ToastMessage } from "./components/Toast.js";
import { DeployGuard } from "./components/DeployGuard.js";
import { StatusPill, deriveStatus } from "./components/StatusPill.js";
import { FlowTabs } from "./components/FlowTabs.js";
import { Icon } from "./components/Icon.js";
import { emptyFlow, type EditorNode, type Flow } from "./canvas/flows.js";
import { useValueHistory } from "./canvas/use-value-history.js";
import type { EvalResults } from "../../shared/results.js";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  applyEditorSnapshotDiff,
  decodeUpdateBase64,
  emptyEditorDocumentSnapshot,
  snapshotFromEditorDoc,
  type CollabEdge,
  type CollabNode,
  type EditorDocumentSnapshot,
} from "../../shared/collab.js";

const nodeTypes = { rw: RWNode, comment: CommentNode };
const DEFAULT_AESTHETIC: Aesthetic = "ide";

const isRWNode = (n: EditorNode): n is RWNodeType => n.type === "rw";
const isCommentNode = (n: EditorNode): n is CommentNodeType => n.type === "comment";

/**
 * Marks every live value as last-known (stale) so chips grey out while the feed is down.
 * Errors and absent values are left as-is — only flowing values become stale.
 */
function staleResults(r: EvalResults): EvalResults {
  const stale = <T,>(map: Record<string, T | null>): Record<string, T | null> => {
    const out: Record<string, T | null> = {};
    for (const k in map) {
      const v = map[k] as { status?: string } | null;
      out[k] = v && v.status === "ok" ? ({ ...v, status: "stale" } as T) : (v as T | null);
    }
    return out;
  };
  return { ...r, outputs: stale(r.outputs) as EvalResults["outputs"], inputs: stale(r.inputs) };
}

const emptyResults = (): EvalResults => ({ outputs: {}, inputs: {}, health: {}, actions: {}, connected: {}, sinks: {} });
const collabServerOrigin = { source: "server" };
const collabLocalOrigin = { source: "local" };

function nodesForCollab(nodes: EditorNode[]): CollabNode[] {
  return nodes.map((node) => {
    const { selected: _selected, ...rest } = node as EditorNode & { selected?: boolean };
    return rest as unknown as CollabNode;
  });
}

function edgesForCollab(edges: Edge[]): CollabEdge[] {
  return edges.map((edge) => ({ ...edge }) as unknown as CollabEdge);
}

function withInitialSize(node: EditorNode): EditorNode {
  if (node.type === "rw") {
    const def = (node as RWNodeType).data.def;
    const g = nodeGeom(def);
    return { ...node, initialWidth: g.w, initialHeight: g.h } as EditorNode;
  }
  if (node.type === "comment") {
    const data = (node as CommentNodeType).data;
    return { ...node, initialWidth: data.w, initialHeight: data.h } as EditorNode;
  }
  return node;
}

function rwEditorNode(id: string, def: NodeData, position: { x: number; y: number }, zIndex = 1): EditorNode {
  return withInitialSize({ id, type: "rw", position, dragHandle: ".rw-drag", zIndex, data: { def } } as EditorNode);
}

function collabNodeToEditor(node: CollabNode): EditorNode {
  return withInitialSize({ ...node, selected: false } as unknown as EditorNode);
}

function collabEdgeToEditor(edge: CollabEdge): Edge {
  return { ...edge } as unknown as Edge;
}

function snapshotEqual(a: EditorDocumentSnapshot | null, b: EditorDocumentSnapshot): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

function entityIcon(entityId: string): NodeData["icon"] {
  if (entityId.startsWith("sun.")) return "sun";
  if (entityId.startsWith("binary_sensor.")) return "motion";
  if (entityId.startsWith("light.")) return "bulb";
  return "ha";
}

export function App() {
  const aesthetic = DEFAULT_AESTHETIC;
  const [mode, setMode] = useState<Mode>("dark");
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  // The document holds several independent flows; the live node/edge stores above are the active
  // flow's working copy. Switching tabs stashes the working copy back into its flow and loads the
  // next one. Inactive flows keep their nodes/edges here.
  const [flows, setFlows] = useState<Flow[]>(() => [{ ...emptyFlow("Flow 1"), nodes: initialNodes, edges: initialEdges }]);
  const [activeFlowId, setActiveFlowId] = useState(() => flows[0].id);
  const flowTabs = useMemo(() => flows.map((f) => ({ id: f.id, name: f.name })), [flows]);
  // Graph nodes only — comment frames live in the same store but are filtered out of evaluation.
  const rwNodes = useMemo(() => nodes.filter(isRWNode), [nodes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const macroLib = useMacros();
  const [editingMacro, setEditingMacro] = useState<MacroDef | null>(null);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [liveDeployed, setLiveDeployed] = useState(false);
  const [deployPending, setDeployPending] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectColor, setConnectColor] = useState<string>(TYPE_VAR.any);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Undo/redo over canvas snapshots. A checkpoint captures nodes + edges before a mutation.
  type Snapshot = { nodes: EditorNode[]; edges: Edge[] };
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // Offline simulated entities, used when not connected to the server's live feed.
  const [simEntities, setSimEntities] = useState<EntityMap>(() => simulate(0));
  const phase = useRef(0);
  useEffect(() => {
    const id = setInterval(() => {
      phase.current += 0.06;
      setSimEntities(simulate(phase.current));
    }, 90);
    return () => clearInterval(id);
  }, []);

  const server = useServer();
  const collabDoc = useRef(new Y.Doc());
  const collabReady = useRef(false);
  const applyingCollab = useRef(false);
  const lastCollabSnapshot = useRef<EditorDocumentSnapshot | null>(null);
  const appliedDocStateNonce = useRef<number | null>(null);
  const appliedDocUpdateNonce = useRef<number | null>(null);
  const clientId = useRef(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10));
  // Stateful-node memory is kept per flow so identical node ids in different flows never share state.
  // It is advanced from a committed effect, not during React render, so StrictMode/aborted
  // renders cannot consume edge pulses or toggle transitions.
  const memories = useRef<Record<string, Memory>>({});
  const hasSeenServer = server.connected || lastSync !== null;
  const entities = server.connected ? server.entities : hasSeenServer ? server.entities : simEntities;
  const entityTemplates = useMemo<NodeTemplate[]>(() => {
    const base = PALETTE.find((t) => t.type === "entity");
    if (!base) return [];
    return Object.keys(entities).sort().slice(0, 80).map((entityId) => ({
      type: `entity:${entityId}`,
      category: "Entities",
      label: entityId,
      icon: entityIcon(entityId),
      make: (id) => {
        const e = entities[entityId];
        const icon = entityIcon(entityId);
        const def = base.make(id);
        return {
          ...def,
          title: entityId,
          icon,
          config: { ...def.config, entity_id: entityId },
          outputs: def.outputs.map((p) => (p.id === "state" ? { ...p, type: entityStateType(entityId, e?.state ?? "", e?.attributes ?? {}) } : p)),
        };
      },
    }));
  }, [entities]);
  const paletteTemplates = useMemo(() => [...PALETTE, ...entityTemplates], [entityTemplates]);

  // A transient message bottom-right; the latest one replaces any earlier one.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = useCallback((text: string, kind: ToastMessage["kind"]) => {
    setToast({ text, kind, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Remember when the live feed was last seen, to label the disconnected banner.
  useEffect(() => {
    if (server.connected) {
      setLastSync(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }
  }, [server.connected]);

  // A clock the preview reads as "now" (epoch ms). Ticking it re-renders, so time-dependent
  // derivations (now, elapsed durations) advance on their own even when no entity changes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const viewEdges = useMemo<ViewEdge[]>(() => edges.map((e) => ({
    id: e.id,
    from: { node: e.source, pin: e.sourceHandle ?? "" },
    to: { node: e.target, pin: e.targetHandle ?? "" },
  })), [edges]);
  const nodeDefs = useMemo(() => rwNodes.map((n) => n.data.def), [rwNodes]);
  const [liveResults, setLiveResults] = useState<EvalResults>(() => emptyResults());
  const previewCommit = useRef<{
    activeFlowId: string;
    nodeDefs: NodeData[];
    viewEdges: ViewEdge[];
    entities: EntityMap;
    now: number;
    macros: MacroMap;
  } | null>(null);
  useEffect(() => {
    const previous = previewCommit.current;
    if (
      previous &&
      previous.activeFlowId === activeFlowId &&
      previous.nodeDefs === nodeDefs &&
      previous.viewEdges === viewEdges &&
      previous.entities === entities &&
      previous.now === now &&
      previous.macros === macroLib.macros
    ) {
      return;
    }
    previewCommit.current = { activeFlowId, nodeDefs, viewEdges, entities, now, macros: macroLib.macros };
    const flowMemory = (memories.current[activeFlowId] ??= {});
    setLiveResults(evaluate(nodeDefs, viewEdges, entities, flowMemory, now, {}, macroLib.macros));
  }, [activeFlowId, nodeDefs, viewEdges, entities, now, macroLib.macros]);
  // While a previously connected feed is down, keep the last server values greyed as stale.
  // Before any server has connected, the app remains in local demo mode with live simulated values.
  const results = server.connected || !hasSeenServer ? liveResults : staleResults(liveResults);

  const problems = deriveProblems(nodeDefs, results, server.connected);
  const { errors: errorCount, warns: warnCount } = problemCounts(problems);

  // The graph is actuating the home only when connected and either auto-deploying or freshly deployed.
  const actuating = (autoDeploy || liveDeployed) && server.connected;

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const deploy = server.deploy;

  const localDocumentSnapshot = useCallback((): EditorDocumentSnapshot => {
    const stashedFlows = flows.map((flow) =>
      flow.id === activeFlowId
        ? { ...flow, nodes: nodesRef.current, edges: edgesRef.current }
        : flow,
    );
    const snapshotFlows = stashedFlows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      nodes: nodesForCollab(flow.nodes),
      edges: edgesForCollab(flow.edges),
    }));
    if (snapshotFlows.length === 0) snapshotFlows.push(emptyEditorDocumentSnapshot().flows[0]!);
    // The active tab is local UI state. Persist a stable fallback only so old/new clients have a
    // valid active flow if their current tab disappears, but don't make collaborators fight over it.
    return { version: 1, activeFlowId: snapshotFlows[0]?.id, flows: snapshotFlows, macros: macroLib.macros };
  }, [activeFlowId, flows, macroLib.macros]);

  const suppressNextAutoDeploy = useRef(false);

  const applyRemoteDocumentSnapshot = useCallback((snapshot: EditorDocumentSnapshot) => {
    applyingCollab.current = true;
    suppressNextAutoDeploy.current = true;
    const nextFlows = snapshot.flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      nodes: flow.nodes.map(collabNodeToEditor),
      edges: flow.edges.map(collabEdgeToEditor),
    }));
    const nextActive = nextFlows.find((flow) => flow.id === activeFlowId)?.id ?? snapshot.activeFlowId ?? nextFlows[0]?.id;
    setFlows(nextFlows);
    const active = nextFlows.find((flow) => flow.id === nextActive) ?? nextFlows[0];
    if (active) {
      setActiveFlowId(active.id);
      setNodes(active.nodes);
      setEdges(active.edges);
    }
    macroLib.replace(snapshot.macros);
    setSelected((id) => (id && active?.nodes.some((node) => node.id === id) ? id : null));
    setSelectedIds((ids) => ids.filter((id) => active?.nodes.some((node) => node.id === id)));
    setPast([]);
    setFuture([]);
    queueMicrotask(() => {
      applyingCollab.current = false;
    });
  }, [activeFlowId, macroLib.replace, setEdges, setNodes]);

  const localSnapshotHasUserContent = (snapshot: EditorDocumentSnapshot): boolean =>
    snapshot.flows.length > 1 ||
    snapshot.flows.some((flow) => flow.nodes.length > 0 || flow.edges.length > 0 || flow.name !== "Flow 1") ||
    Object.keys(snapshot.macros).length > 0;

  const flushLocalDocumentToCollab = useCallback((allowBeforeReady = false) => {
    if ((!allowBeforeReady && !collabReady.current) || applyingCollab.current) return;
    const next = localDocumentSnapshot();
    if (allowBeforeReady && !collabReady.current && !localSnapshotHasUserContent(next)) return;
    if (snapshotEqual(lastCollabSnapshot.current, next)) return;
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
  }, [nodes, edges, flows, activeFlowId, macroLib.macros, flushLocalDocumentToCollab]);

  // Record a checkpoint of the current canvas before a mutation, clearing the redo branch.
  const pushHistory = useCallback(() => {
    setPast((p) => [...p.slice(-40), { nodes: nodesRef.current, edges: edgesRef.current }]);
    setFuture([]);
  }, []);
  const undo = useCallback(() => {
    setPast((p) => {
      if (!p.length) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [{ nodes: nodesRef.current, edges: edgesRef.current }, ...f]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      return p.slice(0, -1);
    });
  }, [setNodes, setEdges]);
  const redo = useCallback(() => {
    setFuture((f) => {
      if (!f.length) return f;
      const next = f[0];
      setPast((p) => [...p, { nodes: nodesRef.current, edges: edgesRef.current }]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(1);
    });
  }, [setNodes, setEdges]);

  // React Flow's own Delete/Backspace handler removes selected nodes and edges by feeding "remove"
  // changes into the stores. Checkpoint the canvas here, before those changes land, so the deletion
  // is undoable. Returning true lets the deletion proceed unchanged.
  const onBeforeDelete = useCallback(async () => {
    pushHistory();
    return true;
  }, [pushHistory]);

  // ── Flows (tabs) ────────────────────────────────────────────────────────────
  // Switch to another flow: stash the active working store into its flow entry, then load the
  // target flow's nodes and edges into the working store. Undo history is per session, not per
  // flow, so it is cleared on switch to avoid restoring a snapshot into the wrong flow.
  const switchFlow = useCallback(
    (id: string) => {
      if (id === activeFlowId) return;
      setFlows((fs) => {
        const target = fs.find((f) => f.id === id);
        if (!target) return fs;
        const stashed = fs.map((f) => (f.id === activeFlowId ? { ...f, nodes: nodesRef.current, edges: edgesRef.current } : f));
        setNodes(target.nodes);
        setEdges(target.edges);
        return stashed;
      });
      setActiveFlowId(id);
      setSelected(null);
      setSelectedIds([]);
      setPast([]);
      setFuture([]);
    },
    [activeFlowId, setNodes, setEdges],
  );

  const addFlow = useCallback(() => {
    const f = emptyFlow(`Flow ${flows.length + 1}`);
    setFlows((fs) => fs.map((x) => (x.id === activeFlowId ? { ...x, nodes: nodesRef.current, edges: edgesRef.current } : x)).concat(f));
    setNodes([]);
    setEdges([]);
    setActiveFlowId(f.id);
    setSelected(null);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
  }, [flows.length, activeFlowId, setNodes, setEdges]);

  const renameFlow = useCallback((id: string, name: string) => {
    setFlows((fs) => fs.map((f) => (f.id === id ? { ...f, name } : f)));
  }, []);

  const closeFlow = useCallback(
    (id: string) => {
      setFlows((fs) => {
        if (fs.length <= 1) return fs;
        const idx = fs.findIndex((f) => f.id === id);
        const rest = fs.filter((f) => f.id !== id);
        delete memories.current[id];
        // When closing the active flow, fall to a neighbour and load its store.
        if (id === activeFlowId) {
          const next = rest[Math.max(0, idx - 1)];
          setNodes(next.nodes);
          setEdges(next.edges);
          setActiveFlowId(next.id);
          setSelected(null);
          setSelectedIds([]);
          setPast([]);
          setFuture([]);
        }
        return rest;
      });
    },
    [activeFlowId, setNodes, setEdges],
  );

  // Signature of the deployable graph: structure + config + wiring, ignoring node positions.
  // Changes only on meaningful edits — not on entity-feed re-renders or node drags.
  const macrosRef = useRef<MacroMap>(macroLib.macros);
  macrosRef.current = macroLib.macros;

  const graphSig = useMemo(
    () =>
      JSON.stringify({
        n: rwNodes.map((n) => ({ id: n.id, t: n.data.def.type, c: n.data.def.config ?? null, v: n.data.def.values ?? null })),
        e: edges.map((x) => ({ s: x.source, sh: x.sourceHandle, t: x.target, th: x.targetHandle })),
        m: macroLib.macros,
      }),
    [rwNodes, edges, macroLib.macros],
  );

  const deployNow = useCallback(() => {
    const e = edgesRef.current.map((x) => ({
      id: x.id,
      from: { node: x.source, pin: x.sourceHandle ?? "" },
      to: { node: x.target, pin: x.targetHandle ?? "" },
    }));
    // Comment frames travel with the graph as annotations, so they round-trip on save/load.
    const comments = nodesRef.current
      .filter(isCommentNode)
      .map((c) => ({ id: c.id, x: c.position.x, y: c.position.y, ...c.data }));
    const sent = deploy({ nodes: nodesRef.current.filter(isRWNode).map((n) => n.data.def), edges: e, macros: macrosRef.current, comments });
    setDeployOpen(false);
    if (sent) {
      setDeployPending(true);
    } else {
      setDeployPending(false);
      setLiveDeployed(false);
      showToast("Deploy was not sent — editor feed is disconnected", "error");
    }
  }, [deploy, showToast]);

  useEffect(() => {
    if (!deployPending || !server.lastResult) return;
    setDeployPending(false);
    setLiveDeployed(server.lastResult.ok);
    if (!server.lastResult.ok) showToast(server.lastResult.error ? `Deploy failed: ${server.lastResult.error}` : "Deploy failed", "error");
  }, [deployPending, server.lastResult, showToast]);

  // The Deploy button opens a guard first; auto-deploy bypasses it (the user already opted in).
  const requestDeploy = useCallback(() => setDeployOpen(true), []);

  // Auto-deploy: redeploy (debounced) when the deployable graph changes locally. Remote
  // collaborator updates become a draft in this browser; they must not actuate HA through a
  // different user's auto-deploy setting.
  useEffect(() => {
    if (suppressNextAutoDeploy.current) {
      suppressNextAutoDeploy.current = false;
      return;
    }
    if (!autoDeploy || !server.connected) return;
    const t = setTimeout(deployNow, 400);
    return () => clearTimeout(t);
  }, [autoDeploy, server.connected, graphSig, deployNow]);

  // Editing returns the graph to a draft (sinks dry-run) until the next deploy.
  useEffect(() => {
    if (!autoDeploy) {
      setLiveDeployed(false);
      setDeployPending(false);
    }
  }, [graphSig, autoDeploy]);

  const onConnect = useCallback(
    (c: Connection) => {
      pushHistory();
      setEdges((eds) => addEdge({ ...c, animated: true, style: edgeStyle(rwNodes, c.source, c.sourceHandle) }, eds));
      // Connecting a variadic node's trailing empty pin fills it and grows the next one.
      if (c.target && c.targetHandle) {
        const handle = c.targetHandle;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === c.target && isRWNode(n) ? { ...n, data: { def: growVariadic(n.data.def, handle) } } : n,
          ),
        );
      }
    },
    [rwNodes, setEdges, setNodes, pushHistory],
  );
  const isValidConnection: IsValidConnection = useCallback((c) => connectionValid(rwNodes, edges, c as Connection), [rwNodes, edges]);

  // When a drag ends on a pin but the wire was rejected, explain why instead of failing silently.
  type EndHandle = { nodeId: string; id?: string | null; type: "source" | "target" } | null | undefined;
  const onConnectEnd = useCallback(
    (_event: unknown, state: { isValid?: boolean | null; fromHandle?: EndHandle; toHandle?: EndHandle }) => {
      setConnecting(false);
      const from = state?.fromHandle;
      const to = state?.toHandle;
      if (!state || state.isValid || !from || !to) return;
      // A drop onto the same side (output->output or input->input) can never wire; say so plainly
      // rather than letting it fall through to a misleading type-mismatch message.
      if (from.type === to.type) {
        showToast(from.type === "source" ? "Cannot connect two outputs." : "Cannot connect two inputs.", "error");
        return;
      }
      // The drag can start from either side; the source is whichever handle is an output.
      const src = from.type === "source" ? from : to;
      const tgt = from.type === "source" ? to : from;
      const c: Connection = {
        source: src.nodeId,
        sourceHandle: src.id ?? null,
        target: tgt.nodeId,
        targetHandle: tgt.id ?? null,
      };
      const reason = connectionReason(rwNodes, edges, c);
      if (reason) showToast(reason, "error");
    },
    [rwNodes, edges, showToast],
  );
  const onConfig = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      setNodes((ns) =>
        ns.map((n) => {
          if (!(n.id === id && isRWNode(n))) return n;
          const def = { ...n.data.def, config: { ...n.data.def.config, ...patch } };
          // When an entity node points at a new entity, re-type its state pin from that entity's
          // metadata so the handle color and connection rules match the value the engine resolves.
          if (def.type === "entity" && "entity_id" in patch) {
            const entityId = String(patch.entity_id ?? "");
            const e = entities[entityId];
            const stateType = entityStateType(entityId, e?.state ?? "", e?.attributes ?? {});
            def.title = entityId || "entity";
            def.icon = entityIcon(entityId);
            def.outputs = def.outputs.map((p) => (p.id === "state" ? { ...p, type: stateType } : p));
          }
          return { ...n, data: { def } };
        }),
      ),
    [setNodes, entities],
  );
  const onSetValue = useCallback(
    (id: string, pin: string, value: unknown) =>
      setNodes((ns) =>
        ns.map((n) => (n.id === id && isRWNode(n) ? { ...n, data: { def: { ...n.data.def, values: { ...n.data.def.values, [pin]: value } } } } : n)),
      ),
    [setNodes],
  );

  const rf = useRef<ReactFlowInstance<EditorNode, Edge> | null>(null);
  const [zoom, setZoom] = useState(1);
  const zoomOut = useCallback(() => void rf.current?.zoomOut({ duration: 160 }), []);
  const zoomIn = useCallback(() => void rf.current?.zoomIn({ duration: 160 }), []);
  const fitCanvas = useCallback(() => void rf.current?.fitView({ padding: 0.25, maxZoom: 1, duration: 260 }), []);
  const idc = useRef(0);
  const [pending, setPending] = useState<{ nodeId: string; requires: RequiredConfig } | null>(null);

  const addNodeAt = useCallback(
    (t: NodeTemplate, position: { x: number; y: number }) => {
      pushHistory();
      idc.current += 1;
      const id = `${t.type}-${clientId.current}-${idc.current}`;
      const def = t.make(id);
      setNodes((ns) => ns.concat(rwEditorNode(id, def, position)));
      setSelected(id);
      if (t.requires) setPending({ nodeId: id, requires: t.requires });
    },
    [setNodes, pushHistory],
  );
  const addNode = useCallback(
    (t: NodeTemplate) => {
      const off = (idc.current % 6) * 26;
      addNodeAt(t, { x: 160 + off, y: 120 + off });
    },
    [addNodeAt],
  );
  // Drop a macro placement at a canvas position: a fresh instance with its own state.
  const placeMacroAt = useCallback(
    (def: MacroDef, position: { x: number; y: number }) => {
      pushHistory();
      idc.current += 1;
      const id = `macro-${def.id}-${clientId.current}-${idc.current}`;
      const inst = makeMacroInstance(def, id, position.x, position.y);
      setNodes((ns) => ns.concat(rwEditorNode(id, inst, position)));
      setSelected(id);
    },
    [setNodes, pushHistory],
  );
  const placeMacro = useCallback(
    (def: MacroDef) => placeMacroAt(def, { x: 200 + (idc.current % 6) * 26, y: 140 + (idc.current % 6) * 26 }),
    [placeMacroAt],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (!rf.current) return;
      const pos = rf.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const macroId = e.dataTransfer.getData("application/reactflow-macro");
      if (macroId) {
        const def = macroLib.macros[macroId];
        if (def) placeMacroAt(def, pos);
        return;
      }
      const type = e.dataTransfer.getData("application/reactflow");
      const t = paletteTemplates.find((x) => x.type === type);
      if (t) addNodeAt(t, pos);
    },
    [addNodeAt, placeMacroAt, macroLib.macros, paletteTemplates],
  );

  // Group the current multi-selection into a macro: build the definition, register it, and replace
  // the selected nodes with a single placement wired to the same neighbors.
  const groupIntoMacro = useCallback(() => {
    if (selectedIds.length < 1) return;
    pushHistory();
    const defs = rwNodes.map((n) => n.data.def);
    const veAll: ViewEdge[] = edgesRef.current.map((x) => ({ id: x.id, from: { node: x.source, pin: x.sourceHandle ?? "" }, to: { node: x.target, pin: x.targetHandle ?? "" } }));
    const center = { x: Math.min(...rwNodes.filter((n) => selectedIds.includes(n.id)).map((n) => n.position.x)), y: Math.min(...rwNodes.filter((n) => selectedIds.includes(n.id)).map((n) => n.position.y)) };
    const r = groupSelection(defs, veAll, selectedIds, macroLib.macros, center, `Macro ${Object.keys(macroLib.macros).length + 1}`);
    if (!r) return;
    macroLib.put(r.def);
    const removed = new Set(r.removedNodeIds);
    const removedE = new Set(r.removedEdgeIds);
    setNodes((ns) => ns.filter((n) => !removed.has(n.id)).concat(rwEditorNode(r.instance.id, r.instance, center)));
    setEdges((es) =>
      es
        .filter((e) => !removedE.has(e.id))
        .concat(
          r.newEdges.map((e) => ({ id: e.id, source: e.from.node, sourceHandle: e.from.pin, target: e.to.node, targetHandle: e.to.pin, animated: true, style: edgeStyle(rwNodes, e.from.node, e.from.pin) })),
        ),
    );
    setSelected(r.instance.id);
    setSelectedIds([r.instance.id]);
  }, [selectedIds, rwNodes, macroLib, setNodes, setEdges, pushHistory]);

  // Persist a macro edit and bring every placement of it back in line with the new definition.
  const saveMacro = useCallback(
    (def: MacroDef) => {
      const macros = { ...macroLib.macros, [def.id]: def };
      macroLib.put(def);
      setNodes((ns) => ns.map((n) => (isRWNode(n) ? { ...n, data: { def: syncInstance(n.data.def, macros) } } : n)));
      setEditingMacro(null);
    },
    [macroLib, setNodes],
  );
  const importMacros = useCallback(
    (next: MacroMap, _rootId: string) => macroLib.replace(next),
    [macroLib],
  );
  // Open a macro's definition canvas by id (from the inspector's Edit button or a double-click).
  const editMacroById = useCallback(
    (macroId: string) => {
      const def = macroLib.macros[macroId];
      if (def) setEditingMacro(def);
    },
    [macroLib.macros],
  );
  // Double-clicking a macro placement opens its definition, the same entry point as Edit.
  const onNodeDoubleClick = useCallback(
    (_e: unknown, node: EditorNode) => {
      if (isRWNode(node) && isMacroInstance(node.data.def.type)) {
        editMacroById(String(node.data.def.config?.macroId ?? ""));
      }
    },
    [editMacroById],
  );

  const onSelectionChange = useCallback(
    (p: OnSelectionChangeParams) => {
      setSelected(p.nodes[0]?.id ?? null);
      setSelectedIds(p.nodes.map((n) => n.id));
      // On mobile, selecting a graph node slides up the inspector sheet to inspect it.
      if (isMobile && p.nodes[0] && p.nodes[0].type === "rw") setSheetOpen(true);
    },
    [isMobile],
  );

  // Pan to a node and select it — the Problems panel uses this to focus an offending node.
  const focusNode = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !rf.current) return;
    const w = isRWNode(node) ? node.data.def.w ?? 210 : node.data.w;
    rf.current.setCenter(node.position.x + w / 2, node.position.y + 80, { zoom: 1, duration: 400 });
    setSelected(id);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  }, [setNodes]);

  // Color the in-progress connection line by the dragged pin's type (grey if unresolved).
  const onConnectStart = useCallback((_: unknown, params: OnConnectStartParams) => {
    setConnecting(true);
    const node = nodesRef.current.find((n) => n.id === params.nodeId);
    const def = node && isRWNode(node) ? node.data.def : undefined;
    const pin = def?.outputs.find((p) => p.id === params.handleId) ?? def?.inputs.find((p) => p.id === params.handleId);
    setConnectColor(TYPE_VAR[pin?.type ?? "any"]);
  }, []);

  // ── Comment frames ──────────────────────────────────────────────────────────
  const updateComment = useCallback(
    (id: string, patch: Partial<CommentData>) => {
      pushHistory();
      setNodes((ns) => ns.map((n) => (n.id === id && isCommentNode(n) ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes, pushHistory],
  );
  const deleteComment = useCallback(
    (id: string) => {
      pushHistory();
      setNodes((ns) => ns.filter((n) => n.id !== id));
    },
    [setNodes, pushHistory],
  );

  // A resize handle drags a frame edge or corner in flow space; the matching opposite edge stays put.
  const resizeState = useRef<{ id: string; dir: ResizeDir; start: { x: number; y: number; w: number; h: number }; px: number; py: number } | null>(null);
  const onResizeStart = useCallback(
    (id: string, dir: ResizeDir, e: React.PointerEvent) => {
      const node = nodesRef.current.find((n) => n.id === id);
      if (!node || !isCommentNode(node)) return;
      pushHistory();
      resizeState.current = { id, dir, start: { x: node.position.x, y: node.position.y, w: node.data.w, h: node.data.h }, px: e.clientX, py: e.clientY };
      const zoom = rf.current?.getZoom() ?? 1;
      const onMove = (ev: PointerEvent) => {
        const s = resizeState.current;
        if (!s) return;
        const dx = (ev.clientX - s.px) / zoom;
        const dy = (ev.clientY - s.py) / zoom;
        const r = resizeFrame(s.start, s.dir, dx, dy);
        setNodes((ns) => ns.map((n) => (n.id === s.id && isCommentNode(n) ? { ...n, position: { x: r.x, y: r.y }, data: { ...n.data, w: r.w, h: r.h } } : n)));
      };
      const onUp = () => {
        resizeState.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [setNodes, pushHistory],
  );

  const commentOps: CommentOps = useMemo(
    () => ({
      onRename: (id, title) => updateComment(id, { title }),
      onRecolor: (id, color: CommentColor) => updateComment(id, { color }),
      onDelete: deleteComment,
      onResizeStart,
    }),
    [updateComment, deleteComment, onResizeStart],
  );

  // Add a frame around the selected node (if any), else at the centre of the current view.
  const cmtc = useRef(0);
  const addComment = useCallback(() => {
    pushHistory();
    cmtc.current += 1;
    const id = `comment-${clientId.current}-${cmtc.current}`;
    const sel = nodesRef.current.find((n) => n.id === selected && isRWNode(n)) as RWNodeType | undefined;
    let position: { x: number; y: number };
    let data: CommentData;
    const color = COMMENT_COLOR_KEYS[cmtc.current % COMMENT_COLOR_KEYS.length];
    if (sel) {
      const g = nodeGeom(sel.data.def);
      const pad = 38;
      position = { x: sel.position.x - pad, y: sel.position.y - pad - 8 };
      data = { title: "Comment", color, w: g.w + pad * 2, h: g.h + pad * 2 + 8 };
    } else {
      const center = rf.current?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 0, y: 0 };
      position = { x: Math.round(center.x - 170), y: Math.round(center.y - 110) };
      data = { title: "Comment", color, w: 340, h: 220 };
    }
    // A low z-index keeps the frame behind the graph nodes it groups.
    setNodes((ns) => ns.concat(withInitialSize({ id, type: "comment", position, dragHandle: ".rw-drag", zIndex: 0, data } as EditorNode)));
    setSelected(id);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
    showToast("Comment added — drag its bar to move the group", "info");
  }, [selected, setNodes, showToast, pushHistory]);

  // Dragging a comment bar carries the nodes whose centre sits inside the frame at drag start.
  const dragCarry = useRef<{ id: string; sx: number; sy: number; members: { id: string; x: number; y: number }[] } | null>(null);
  const onNodeDragStart = useCallback(
    (_e: unknown, node: EditorNode) => {
      // One checkpoint for the whole drag gesture.
      pushHistory();
      if (!isCommentNode(node)) return;
      const frame = { x: node.position.x, y: node.position.y, w: node.data.w, h: node.data.h };
      const members = nodesRef.current
        .filter((n): n is RWNodeType => isRWNode(n) && nodeCenterInside(n, frame))
        .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }));
      dragCarry.current = { id: node.id, sx: node.position.x, sy: node.position.y, members };
    },
    [pushHistory],
  );
  const onNodeDrag = useCallback(
    (_e: unknown, node: EditorNode) => {
      const carry = dragCarry.current;
      if (!carry || carry.id !== node.id) return;
      const dx = node.position.x - carry.sx;
      const dy = node.position.y - carry.sy;
      const byId = new Map(carry.members.map((m) => [m.id, m]));
      setNodes((ns) => ns.map((n) => {
        const m = byId.get(n.id);
        return m ? { ...n, position: { x: m.x + dx, y: m.y + dy } } : n;
      }));
    },
    [setNodes],
  );
  const onNodeDragStop = useCallback(() => {
    dragCarry.current = null;
  }, []);

  // Keyboard shortcuts: undo/redo and add-comment, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      // Never steal keys while typing into a field (a node value editor, the macro name, a comment
      // title) — Backspace must edit text and Ctrl+Z must undo the text edit, not the canvas.
      if (tag === "input" || tag === "select" || tag === "textarea" || el?.isContentEditable) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Undo / redo: Ctrl+Z, Ctrl+Shift+Z, and the Windows-style Ctrl+Y for redo.
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (key === "c" && !mod) {
        e.preventDefault();
        addComment();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, addComment]);

  const themeVars = buildThemeVars(aesthetic, mode) as CSSProperties;
  const grid = gridStyle(aesthetic);
  const status = deriveStatus(server.connected, actuating, !liveDeployed);
  const problemTotal = errorCount + warnCount;
  const deployNote = deployPending
    ? "deploying…"
    : server.lastResult
      ? server.lastResult.ok
        ? `deployed${server.lastResult.unsupported.length ? ` · ${server.lastResult.unsupported.length} skipped` : ""}`
        : "deploy failed"
      : "";
  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const selectedDef = selectedNode && isRWNode(selectedNode) ? selectedNode.data.def : null;

  // Buffer recent values for the selected node's output pins so the inspector can draw a sparkline.
  const observedPins = useMemo(
    () => (selectedDef ? selectedDef.outputs.map((p) => `${selectedDef.id}:${p.id}`) : []),
    [selectedDef],
  );
  const valueHistory = useValueHistory(results, observedPins);

  return (
    <div
      id="rw-root"
      className={cn(
        "rw-root fixed inset-0 flex flex-col bg-rw-bg text-rw-text text-[13px]",
        `mode-${mode}`,
        connecting && "rw-connecting",
        isMobile && "rw-app-mobile",
        navOpen && "nav-open",
        sheetOpen && "sheet-open",
      )}
      style={themeVars}
    >
      <header className="rw-toolbar">
        {isMobile && (
          <button
            onClick={() => setNavOpen((o) => !o)}
            aria-label="Node palette"
            title="Nodes"
            className="rw-icon-btn"
          >
            <Icon name="menu" size={16} />
          </button>
        )}

        <div className="rw-tb-group rw-brand">
          <span className="rw-brand-mark">
            <svg className="rw-logo" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="6" cy="12" r="2.4" />
              <circle cx="18" cy="6" r="2.4" />
              <circle cx="18" cy="18" r="2.4" />
              <path d="M7.7 11l8.6-4M7.7 13l8.6 4" stroke="currentColor" strokeWidth="1.6" fill="none" />
            </svg>
          </span>
          <span className="rw-brand-name">Reactive Wire</span>
        </div>

        <div className="rw-tb-sep rw-hide-mobile" />

        <div className="rw-tb-group rw-hide-mobile" aria-label="History">
          <button className="rw-icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">
            <svg viewBox="0 0 24 24" className="rw-i" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 7 4 12l5 5" />
              <path d="M4 12h11a5 5 0 0 1 0 10h-3" />
            </svg>
          </button>
          <button className="rw-icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">
            <svg viewBox="0 0 24 24" className="rw-i" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 7l5 5-5 5" />
              <path d="M20 12H9a5 5 0 0 0 0 10h3" />
            </svg>
          </button>
        </div>

        <div className="rw-tb-center">
          <StatusPill {...status} />
        </div>

        <div className="rw-tb-spacer" />

        <div className="rw-tb-group rw-deploy-group">
          <label className="rw-autodeploy rw-hide-mobile" title="Deploy automatically after graph edits">
            <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} />
            <span className="rw-checkbox" />
            auto-deploy
          </label>
          <button
            onClick={requestDeploy}
            disabled={!server.connected || deployPending}
            title={server.connected ? "Deploy this graph to the server" : "Editor feed disconnected; live server state is unknown"}
            className="rw-deploy"
          >
            Deploy
            {server.lastResult && (!server.lastResult.ok || server.lastResult.unsupported.length > 0) && (
              <span className={cn("rw-deploy-badge", server.lastResult.ok && "warn")}>
                {server.lastResult.ok ? server.lastResult.unsupported.length : "!"}
              </span>
            )}
          </button>
          {deployNote && <span className={cn("rw-deploy-note rw-hide-mobile", server.lastResult && (server.lastResult.ok ? "ok" : "error"))}>{deployNote}</span>}
        </div>

        <button
          onClick={() => setProblemsOpen((o) => !o)}
          title="Show structural and runtime problems"
          className={cn("rw-problems rw-hide-mobile", problemsOpen && "active", errorCount > 0 && "has-error", errorCount === 0 && warnCount > 0 && "has-warn")}
        >
          <span className="rw-problem-icon">△</span>
          <span className="rw-problem-count">{problemTotal}</span>
        </button>

        <div className="rw-tb-group rw-zoom rw-hide-mobile" aria-label="Zoom">
          <button className="rw-icon-btn" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">−</button>
          <button className="rw-zoom-val" onClick={fitCanvas} title="Fit graph to view">{Math.round(zoom * 100)}%</button>
          <button className="rw-icon-btn" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">+</button>
        </div>

        <div
          className={cn("rw-ha-badge rw-hide-mobile", server.connected ? "online" : "offline")}
          title={server.connected ? "Home Assistant feed connected" : "Home Assistant feed disconnected; live server state is unknown"}
          aria-label={server.connected ? "Home Assistant connected" : "Home Assistant disconnected"}
        >
          <Icon name="ha" size={16} />
        </div>
        <button className="rw-icon-btn" onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))} title="Toggle light / dark" aria-label="Toggle light / dark">
          {mode === "dark" ? "☾" : "☀"}
        </button>
      </header>

      {!server.connected && <Banner lastSync={lastSync} />}

      <FlowTabs
        flows={flowTabs}
        activeId={activeFlowId}
        onSelect={switchFlow}
        onAdd={addFlow}
        onRename={renameFlow}
        onClose={closeFlow}
      />

      <div className="relative flex-1 min-h-0 flex">
        <div className="rw-sidebar-wrap flex min-h-0">
          <Palette onAdd={addNode} extra={entityTemplates}>
            <MacroList
              macros={macroLib.macros}
              onPlace={placeMacro}
              onEdit={setEditingMacro}
              onDelete={macroLib.remove}
              onImport={importMacros}
            />
          </Palette>
        </div>
        <div className={cn("relative flex-1 min-h-0", isMobile && "rw-mobile-stage")} onDrop={onDrop} onDragOver={onDragOver}>
          <div className="rw-canvas-actions rw-hide-mobile" aria-label="Canvas actions">
            <button className="rw-canvas-action" onClick={addComment} title="Add a comment box · wraps the selected node (C)">
              <span className="rw-tool-glyph">▢</span>
              Comment
            </button>
            <button className="rw-canvas-action" onClick={groupIntoMacro} disabled={selectedIds.length < 1} title="Group the selected nodes into a reusable macro">
              <Icon name="macro" size={13} />
              Group
            </button>
          </div>
          <CommentCtx.Provider value={commentOps}>
            <ResultsProvider value={{ results, actuating, entities, onConfig, onSetValue }}>
              <ReactFlow
                onInit={(inst) => {
                  rf.current = inst;
                }}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodeDoubleClick={onNodeDoubleClick}
                connectionLineStyle={{ stroke: connectColor, strokeWidth: 2.2 }}
                isValidConnection={isValidConnection}
                onSelectionChange={onSelectionChange}
                onBeforeDelete={onBeforeDelete}
                onMove={(_, viewport) => setZoom(viewport.zoom)}
                nodeTypes={nodeTypes}
                colorMode={mode}
                deleteKeyCode={["Backspace", "Delete"]}
                elevateNodesOnSelect={false}
                multiSelectionKeyCode={["Control", "Meta", "Shift"]}
                selectionKeyCode="Shift"
                selectionOnDrag={false}
                panOnDrag
                edgesFocusable
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
                minZoom={0.3}
                maxZoom={2.5}
              >
                <Background
                  variant={grid === "lines" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
                  gap={24}
                  size={grid === "lines" ? 1 : 2.4}
                  lineWidth={1}
                  color="var(--rw-grid-dot)"
                  bgColor="var(--rw-canvas)"
                />
                <Controls />
              </ReactFlow>
            </ResultsProvider>
          </CommentCtx.Provider>
          <ProblemsPanel
            problems={problems}
            open={problemsOpen}
            onClose={() => setProblemsOpen(false)}
            onFocus={focusNode}
          />
        </div>
        <div className="rw-inspector-wrap flex min-h-0">
          <Inspector node={selectedDef} results={results} entities={entities} history={valueHistory} macros={macroLib.macros} onConfig={onConfig} onSetValue={onSetValue} onEditMacro={editMacroById} />
        </div>
      </div>

      {isMobile && (
        <>
          <div className="rw-scrim" onPointerDown={() => { setNavOpen(false); setSheetOpen(false); }} />
          <MobileBar
            onNodes={() => setNavOpen(true)}
            onComment={addComment}
            onUndo={undo}
            onRedo={redo}
            onProblems={() => setProblemsOpen((o) => !o)}
            onInspect={() => setSheetOpen((o) => !o)}
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={!!selected}
            problemCount={errorCount > 0 ? errorCount : warnCount}
          />
        </>
      )}

      {pending && (
        <NodeConfigPopup
          requires={pending.requires}
          entities={entities}
          onConfirm={(value) => {
            onConfig(pending.nodeId, { [pending.requires.field]: value });
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      <DeployGuard
        open={deployOpen}
        problems={problems}
        summary="This graph will derive and reconcile the live state of your home. Review the problems below before it takes control."
        onCancel={() => setDeployOpen(false)}
        onConfirm={deployNow}
      />

      <Toast toast={toast} />

      {editingMacro && (
        <MacroEditor
          def={editingMacro}
          macros={macroLib.macros}
          aesthetic={aesthetic}
          mode={mode}
          themeVars={themeVars}
          onSave={saveMacro}
          onClose={() => setEditingMacro(null)}
        />
      )}
    </div>
  );
}
