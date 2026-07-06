import type { Edge } from "@xyflow/react";
import { nodeGeom } from "../../../shared/node-types.js";
import type { MacroMap } from "../../../shared/macros.js";
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
}

export interface AppliedEditorDocumentState {
  flows: Flow[];
  activeFlowId: string;
  activeNodes: EditorNode[];
  activeEdges: Edge[];
  macros: MacroMap;
  autoDeploy: boolean;
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

function collabEdgeToEditor(edge: CollabEdge): Edge {
  return { ...edge } as unknown as Edge;
}

/**
 * Project the local editor working state into the collaborative document interface.
 * The active flow's React Flow working copy is stashed into its flow entry first; the
 * active tab itself remains local UI state, while settings.deployFlowId records the flow
 * the server should auto-deploy.
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
  const deployFlowId = snapshotFlows.some((flow) => flow.id === state.activeFlowId)
    ? state.activeFlowId
    : snapshotFlows[0]?.id;
  return {
    version: 1,
    activeFlowId: snapshotFlows[0]?.id,
    flows: snapshotFlows,
    macros: state.macros,
    settings: { autoDeploy: state.autoDeploy, deployFlowId },
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
    nodes: flow.nodes.map(collabNodeToEditor),
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
