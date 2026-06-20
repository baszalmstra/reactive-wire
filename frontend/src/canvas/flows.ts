import type { Edge } from "@xyflow/react";
import type { CommentNodeType } from "./comments.js";
import type { RWNodeType } from "./validation.js";

/** A canvas node is either a graph node or a comment frame; both ride the React Flow store. */
export type EditorNode = RWNodeType | CommentNodeType;

/** One independent graph in the document. Each editor tab edits one flow. */
export interface Flow {
  id: string;
  name: string;
  nodes: EditorNode[];
  edges: Edge[];
}

let flowSeq = 0;
export function newFlowId(): string {
  flowSeq += 1;
  return `flow-${Date.now().toString(36)}-${flowSeq}`;
}

export function emptyFlow(name: string): Flow {
  return { id: newFlowId(), name, nodes: [], edges: [] };
}
