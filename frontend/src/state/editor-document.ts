import type { Edge } from "@xyflow/react";
import { nodeGeom, type NodeData } from "../../../shared/node-types.js";
import type { MacroMap } from "../../../shared/macros.js";
import { currentNodeTemplates, reconcileDefs } from "../../../shared/engine/reconcile-defs.js";
import {
  emptyEditorDocumentSnapshot,
  type CollabEdge,
  type CollabNode,
  type EditorDocumentSnapshot,
} from "../../../shared/collab.js";
import type { EditorNode, Flow } from "../canvas/flows.js";
import type { RWNodeType } from "../canvas/validation.js";
import type { CommentNodeType } from "../canvas/comments.js";

const isRWNode = (n: EditorNode): n is RWNodeType => n.type === "rw";
const isCommentNode = (n: EditorNode): n is CommentNodeType => n.type === "comment";

export interface EditorWorkingState {
  flows: Flow[];
  activeFlowId: string;
  activeNodes: EditorNode[];
  activeEdges: Edge[];
  macros: MacroMap;
  autoDeploy: boolean;
  deployedFlowIds: string[];
}

export interface AppliedEditorDocumentState {
  flows: Flow[];
  activeFlowId: string;
  activeNodes: EditorNode[];
  activeEdges: Edge[];
  macros: MacroMap;
  autoDeploy: boolean;
  deployedFlowIds: string[];
}

export function editorNodeWithInitialSize(node: EditorNode): EditorNode {
  if (isRWNode(node)) {
    const g = nodeGeom(node.data.def);
    return { ...node, initialWidth: g.w, initialHeight: g.h } as EditorNode;
  }
  if (isCommentNode(node)) {
    return { ...node, initialWidth: node.data.w, initialHeight: node.data.h } as EditorNode;
  }
  return node;
}

function nodesForCollab(nodes: EditorNode[]): CollabNode[] {
  return nodes.map((node) => {
    const { selected: _selected, ...rest } = node as EditorNode & { selected?: boolean };
    return rest as unknown as CollabNode;
  });
}

function edgesForCollab(edges: Edge[]): CollabEdge[] {
  return edges.map((edge) => ({ ...edge }) as unknown as CollabEdge);
}

function collabNodeToEditor(node: CollabNode): EditorNode {
  return editorNodeWithInitialSize({ ...node, selected: false } as unknown as EditorNode);
}

function defFromCollabNode(node: CollabNode): NodeData | null {
  const data = node.data;
  if (!data || typeof data !== "object") return null;
  const def = (data as { def?: unknown }).def;
  if (!def || typeof def !== "object") return null;
  const d = def as NodeData;
  return typeof d.id === "string" && typeof d.type === "string" ? d : null;
}

/**
 * Heal a flow's stored node defs to the code's current pin shapes as the document is read, so a
 * removed pin surfaces as a ghost (kept while wired) and an added pin appears. Nodes without a def
 * (comments) pass through untouched, and a def unchanged by reconciliation keeps its identity; when
 * nothing in the flow reconciles, the original `nodes` array is returned so the caller can skip
 * rebuilding it (the reconciliation pass itself still allocates its working arrays).
 */
function reconcileFlowNodes(nodes: CollabNode[], edges: CollabEdge[], previousNodes?: CollabNode[]): CollabNode[] {
  const previousById = new Map(previousNodes?.map((node) => [node.id, node]) ?? []);
  const candidates = previousNodes ? nodes.filter((node) => previousById.get(node.id) !== node) : nodes;
  const defs: NodeData[] = [];
  for (const node of candidates) {
    const def = defFromCollabNode(node);
    if (def) defs.push(def);
  }
  if (defs.length === 0) return nodes;
  const wired = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceHandle) wired.add(`${edge.source} ${edge.sourceHandle}`);
    if (edge.targetHandle) wired.add(`${edge.target} ${edge.targetHandle}`);
  }
  const reconciled = reconcileDefs(defs, currentNodeTemplates(), {
    isWired: (nodeId, pinId) => wired.has(`${nodeId} ${pinId}`),
  });
  const byId = new Map<string, NodeData>();
  let changed = false;
  reconciled.forEach((def, i) => {
    if (def !== defs[i]) changed = true;
    byId.set(def.id, def);
  });
  if (!changed) return nodes;
  return nodes.map((node) => {
    if (previousNodes && previousById.get(node.id) === node) return node;
    const def = defFromCollabNode(node);
    const next = def && byId.get(def.id);
    if (!next || next === def) return node;
    return { ...node, data: { ...(node.data as object), def: next } };
  });
}

function collabEdgeToEditor(edge: CollabEdge): Edge {
  return { ...edge } as unknown as Edge;
}

/**
 * Project the local editor working state into the collaborative document interface.
 * The active flow's React Flow working copy is stashed into its flow entry first; the
 * active tab itself remains local UI state; settings.deployedFlowIds records the flow tabs
 * the server should deploy.
 */
export function snapshotFromWorkingState(state: EditorWorkingState): EditorDocumentSnapshot {
  const stashedFlows = state.flows.map((flow) =>
    flow.id === state.activeFlowId
      ? { ...flow, nodes: state.activeNodes, edges: state.activeEdges }
      : flow,
  );
  const snapshotFlows = stashedFlows.map((flow) => ({
    id: flow.id,
    name: flow.name,
    nodes: nodesForCollab(flow.nodes),
    edges: edgesForCollab(flow.edges),
  }));
  if (snapshotFlows.length === 0) snapshotFlows.push(emptyEditorDocumentSnapshot().flows[0]!);
  const deployedFlowIds = state.deployedFlowIds.filter((id, index) =>
    state.deployedFlowIds.indexOf(id) === index && snapshotFlows.some((flow) => flow.id === id),
  );
  return {
    version: 1,
    activeFlowId: snapshotFlows[0]?.id,
    flows: snapshotFlows,
    macros: state.macros,
    settings: { autoDeploy: state.autoDeploy, deployFlowId: deployedFlowIds[0] ?? snapshotFlows[0]?.id, deployedFlowIds },
  };
}

/**
 * Project a collaborative document snapshot back into local editor state. The caller's active
 * flow wins when it still exists so collaborators do not fight over tabs; the snapshot's
 * activeFlowId is only a fallback.
 */
function sameContent(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function samePersistedItem(a: { id: string }, b: { id: string }): boolean {
  const { selected: _aSelected, dragging: _aDragging, resizing: _aResizing, ...aPersisted } = a as typeof a & {
    selected?: boolean;
    dragging?: boolean;
    resizing?: boolean;
  };
  const { selected: _bSelected, dragging: _bDragging, resizing: _bResizing, ...bPersisted } = b as typeof b & {
    selected?: boolean;
    dragging?: boolean;
    resizing?: boolean;
  };
  return sameContent(aPersisted, bPersisted);
}

export interface EditorWorkingProjectionStats {
  flowsProjected: number;
  itemPayloadsCompared: number;
}

function reconcileItems<T extends { id: string }>(
  incoming: T[],
  previous: T[],
  convert: (item: T) => T,
  previousIncoming?: T[],
  stats?: EditorWorkingProjectionStats,
): T[] {
  const priorById = new Map(previous.map((item) => [item.id, item]));
  const priorIncomingById = new Map(previousIncoming?.map((item) => [item.id, item]) ?? []);
  let changed = incoming.length !== previous.length;
  const next = incoming.map((item, index) => {
    const prior = priorById.get(item.id);
    if (prior && priorIncomingById.get(item.id) === item) {
      if (prior !== previous[index]) changed = true;
      return prior;
    }
    if (stats) stats.itemPayloadsCompared += 1;
    const converted = convert(item);
    // Selection/dragging/resizing are local React Flow state and are deliberately absent from the
    // collaborative document. They must not make an otherwise unchanged remote item look changed.
    const value = prior && samePersistedItem(prior, converted) ? prior : converted;
    if (value !== previous[index]) changed = true;
    return value;
  });
  return changed ? next : previous;
}

/**
 * Project a server snapshot while structurally sharing unchanged editor objects. This keeps remote
 * edits to one flow/node from invalidating all React Flow nodes and lets the hook skip unrelated
 * setters and undo resets.
 */
export function workingStateFromSnapshot(
  snapshot: EditorDocumentSnapshot,
  previousActiveFlowId: string,
  previous?: AppliedEditorDocumentState,
  previousSnapshot?: EditorDocumentSnapshot,
  stats?: EditorWorkingProjectionStats,
): AppliedEditorDocumentState {
  const priorFlows = new Map(previous?.flows.map((flow) => [flow.id, flow]) ?? []);
  const priorSnapshotFlows = new Map(previousSnapshot?.flows.map((flow) => [flow.id, flow]) ?? []);
  let flowsChanged = snapshot.flows.length !== (previous?.flows.length ?? -1);
  const flows = snapshot.flows.map((flow, index) => {
    const prior = priorFlows.get(flow.id);
    const priorSnapshot = priorSnapshotFlows.get(flow.id);
    if (prior && priorSnapshot === flow) {
      if (prior !== previous?.flows[index]) flowsChanged = true;
      return prior;
    }
    if (stats) stats.flowsProjected += 1;
    const priorNodes = prior && flow.id === previous?.activeFlowId ? previous.activeNodes : prior?.nodes ?? [];
    const priorEdges = prior && flow.id === previous?.activeFlowId ? previous.activeEdges : prior?.edges ?? [];
    const reconciled = reconcileFlowNodes(
      flow.nodes,
      flow.edges,
      priorSnapshot?.edges === flow.edges ? priorSnapshot.nodes : undefined,
    );
    const nodes = reconcileItems(
      reconciled as unknown as EditorNode[],
      priorNodes,
      (node) => collabNodeToEditor(node as unknown as CollabNode),
      priorSnapshot?.nodes as unknown as EditorNode[] | undefined,
      stats,
    );
    const edges = reconcileItems(
      flow.edges as unknown as Edge[],
      priorEdges,
      (edge) => collabEdgeToEditor(edge as unknown as CollabEdge),
      priorSnapshot?.edges as unknown as Edge[] | undefined,
      stats,
    );
    const value = prior && prior.name === flow.name && nodes === priorNodes && edges === priorEdges
      ? prior
      : { id: flow.id, name: flow.name, nodes, edges };
    if (value !== previous?.flows[index]) flowsChanged = true;
    return value;
  });
  const sharedFlows = !flowsChanged && previous ? previous.flows : flows;
  const nextActive = sharedFlows.find((flow) => flow.id === previousActiveFlowId)?.id
    ?? snapshot.activeFlowId
    ?? sharedFlows[0]?.id;
  const active = sharedFlows.find((flow) => flow.id === nextActive) ?? sharedFlows[0];
  const unchangedActive = previous && active?.id === previous.activeFlowId && priorFlows.get(active.id) === active;
  const deployed = snapshot.settings.deployedFlowIds ?? [snapshot.settings.deployFlowId].filter((id): id is string => !!id);
  return {
    flows: sharedFlows,
    activeFlowId: active?.id ?? nextActive ?? "",
    activeNodes: unchangedActive ? previous.activeNodes : active?.nodes ?? [],
    activeEdges: unchangedActive ? previous.activeEdges : active?.edges ?? [],
    macros: previous && sameContent(previous.macros, snapshot.macros) ? previous.macros : snapshot.macros,
    autoDeploy: snapshot.settings.autoDeploy,
    deployedFlowIds: previous && sameContent(previous.deployedFlowIds, deployed) ? previous.deployedFlowIds : deployed,
  };
}

export function editorSnapshotsEqual(a: EditorDocumentSnapshot | null, b: EditorDocumentSnapshot): boolean {
  if (!a || a.version !== b.version || a.activeFlowId !== b.activeFlowId
    || a.settings.autoDeploy !== b.settings.autoDeploy
    || !sameContent(a.settings.deployedFlowIds, b.settings.deployedFlowIds)
    || !sameContent(a.macros, b.macros) || a.flows.length !== b.flows.length) return false;
  return a.flows.every((flow, index) => {
    const other = b.flows[index];
    return !!other && flow.id === other.id && flow.name === other.name
      && sameContent(flow.nodes, other.nodes) && sameContent(flow.edges, other.edges);
  });
}

export function editorSnapshotHasUserContent(snapshot: EditorDocumentSnapshot): boolean {
  return snapshot.flows.length > 1
    || snapshot.flows.some((flow) => flow.nodes.length > 0 || flow.edges.length > 0 || flow.name !== "Flow 1")
    || Object.keys(snapshot.macros).length > 0;
}
