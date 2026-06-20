import type { NodeData } from "../../node-types.js";

/** Build a NodeData at the origin from a node's intrinsic shape, leaving id/position to the caller. */
export const base = (id: string, partial: Omit<NodeData, "id" | "x" | "y">): NodeData => ({
  id,
  x: 0,
  y: 0,
  ...partial,
});
