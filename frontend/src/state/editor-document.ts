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
function reconcileFlowNodes(nodes: CollabNode[], edges: CollabEdge[]): CollabNode[] {
  const defs: NodeData[] = [];
  for (const node of nodes) {
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
export function workingStateFromSnapshot(
  snapshot: EditorDocumentSnapshot,
  previousActiveFlowId: string,
): AppliedEditorDocumentState {
  const flows = snapshot.flows.map((flow) => ({
    id: flow.id,
    name: flow.name,
    nodes: reconcileFlowNodes(flow.nodes, flow.edges).map(collabNodeToEditor),
    edges: flow.edges.map(collabEdgeToEditor),
  }));
  const nextActive = flows.find((flow) => flow.id === previousActiveFlowId)?.id
    ?? snapshot.activeFlowId
    ?? flows[0]?.id;
  const active = flows.find((flow) => flow.id === nextActive) ?? flows[0];
  return {
    flows,
    activeFlowId: active?.id ?? nextActive ?? "",
    activeNodes: active?.nodes ?? [],
    activeEdges: active?.edges ?? [],
    macros: snapshot.macros,
    autoDeploy: snapshot.settings.autoDeploy,
    deployedFlowIds: snapshot.settings.deployedFlowIds ?? [snapshot.settings.deployFlowId].filter((id): id is string => !!id),
  };
}

export function editorSnapshotsEqual(a: EditorDocumentSnapshot | null, b: EditorDocumentSnapshot): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

export function editorSnapshotHasUserContent(snapshot: EditorDocumentSnapshot): boolean {
  return snapshot.flows.length > 1
    || snapshot.flows.some((flow) => flow.nodes.length > 0 || flow.edges.length > 0 || flow.name !== "Flow 1")
    || Object.keys(snapshot.macros).length > 0;
}
