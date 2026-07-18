import type { NodeData } from "../../node-types.js";

/** Build a NodeData at the origin from a node's intrinsic shape, leaving id/position to the caller. */
export function base<TType extends string>(
  id: string,
  partial: Omit<NodeData<TType>, "id" | "x" | "y">,
): NodeData<TType> {
  // TypeScript cannot reconstruct a conditional config intersection after Omit + spread, even
  // though `partial` already proves the required per-type config contract.
  return { id, x: 0, y: 0, ...partial } as unknown as NodeData<TType>;
}
