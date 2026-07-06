import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnectStartParams,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from "@xyflow/react";
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
import { connectionReason, connectionValid, type RWNodeType } from "./canvas/validation.js";
import { connectionAlreadyWired, replaceInputEdge } from "./canvas/wire-replace.js";
import { CommentNode } from "./canvas/CommentNode.js";
import { RWEdge, withRWEdgeData } from "./canvas/RWEdge.js";
import { CommentCtx } from "./canvas/comments-context.js";
import { type CommentNodeType } from "./canvas/comments.js";
import { MobileBar } from "./components/MobileBar.js";
import { useIsMobile } from "./use-is-mobile.js";
import { useMacros } from "./canvas/use-macros.js";
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
import { type EditorNode } from "./canvas/flows.js";
import { useValueHistory } from "./canvas/use-value-history.js";
import { syncMacroInstances } from "./canvas/macro-editing.js";
import type { EvalResults } from "../../shared/results.js";
import { useUndoRedo } from "./state/use-undo-redo.js";
import { useFlows } from "./state/use-flows.js";
import { useCollabDocument } from "./state/use-collab-document.js";
import { useCommentFrames } from "./state/use-comment-frames.js";

const nodeTypes = { rw: RWNode, comment: CommentNode };
const edgeTypes = { rw: RWEdge };
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
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
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

  const clientId = useRef(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10));
  // Stateful-node memory is kept per flow so identical node ids in different flows never share state.
  // It is advanced from a committed effect, not during React render, so StrictMode/aborted
  // renders cannot consume edge pulses or toggle transitions.
  const memories = useRef<Record<string, Memory>>({});

  const { canUndo, canRedo, pushHistory, undo, redo, onBeforeDelete, setPast, setFuture } = useUndoRedo({
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
  });

  // The document holds several independent flows; the live node/edge stores above are the active
  // flow's working copy. Switching tabs stashes the working copy back into its flow and loads the
  // next one. Inactive flows keep their nodes/edges inside the hook.
  const { flows, setFlows, activeFlowId, setActiveFlowId, flowTabs, switchFlow, addFlow, renameFlow, closeFlow } = useFlows({
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    setSelected,
    setSelectedIds,
    setPast,
    setFuture,
    memories,
  });

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
  const hasSeenServer = server.connected || lastSync !== null;
  const entities = server.connected ? server.entities : hasSeenServer ? server.entities : simEntities;
  const paletteTemplates = PALETTE;

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

  const deploy = server.deploy;

  useCollabDocument({
    server,
    flows,
    setFlows,
    activeFlowId,
    setActiveFlowId,
    nodes,
    edges,
    nodesRef,
    edgesRef,
    macros: macroLib.macros,
    replaceMacros: macroLib.replace,
    autoDeploy,
    setAutoDeploy,
    setNodes,
    setEdges,
    setSelected,
    setSelectedIds,
    setPast,
    setFuture,
    showToast,
  });

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

  // The Deploy button opens a guard first. Auto-deploy is a synced server-side document setting;
  // when enabled, the server deploys the configured flow after collaborative document updates.
  const requestDeploy = useCallback(() => setDeployOpen(true), []);

  // Editing returns the graph to a draft (sinks dry-run) until the next deploy.
  useEffect(() => {
    if (!autoDeploy) {
      setLiveDeployed(false);
      setDeployPending(false);
    }
  }, [graphSig, autoDeploy]);

  const onConnect = useCallback(
    (c: Connection) => {
      // Redrawing the identical wire onto its own input replaces nothing, so skip it rather than
      // record a no-op undo checkpoint and churn state.
      if (connectionAlreadyWired(edgesRef.current, c)) return;
      pushHistory();
      // An input pin holds at most one wire; wiring an already-occupied input replaces the old wire
      // in the same edit, so the checkpoint above makes the whole replace one undo step.
      setEdges((eds) => replaceInputEdge(eds, c));
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
    [setEdges, setNodes, pushHistory],
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
        ns.map((n) => {
          if (!(n.id === id && isRWNode(n))) return n;
          const values = { ...(n.data.def.values ?? {}) };
          if (value === undefined) delete values[pin];
          else values[pin] = value;
          return { ...n, data: { def: { ...n.data.def, values: Object.keys(values).length ? values : undefined } } };
        }),
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
          r.newEdges.map((e) => ({ id: e.id, source: e.from.node, sourceHandle: e.from.pin, target: e.to.node, targetHandle: e.to.pin, type: "rw" })),
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
      setNodes((ns) => {
        const graphNodes = syncMacroInstances(ns.filter(isRWNode), macros);
        const byId = new Map(graphNodes.map((n) => [n.id, n]));
        return ns.map((n) => (isRWNode(n) ? byId.get(n.id) ?? n : n));
      });
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

  const { commentOps, addComment, onNodeDragStart, onNodeDrag, onNodeDragStop } = useCommentFrames({
    nodesRef,
    setNodes,
    setSelected,
    pushHistory,
    selected,
    showToast,
    rf,
    clientId,
  });

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
  const displayEdges = useMemo(() => withRWEdgeData(edges, rwNodes, results), [edges, rwNodes, results]);

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

        <div className="rw-tb-center" aria-label="Deployment and live state">
          <div className="rw-tb-group rw-deploy-group">
            <StatusPill {...status} />
            <label className="rw-autodeploy rw-hide-mobile" title="Server auto-deploys this flow after graph edits">
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
        </div>

        <div className="rw-tb-spacer" />

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
          <Palette onAdd={addNode}>
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
              <ReactFlow<EditorNode, Edge>
                onInit={(inst) => {
                  rf.current = inst;
                }}
                nodes={nodes}
                edges={displayEdges}
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
                edgeTypes={edgeTypes}
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
