import type { NodeData, PinDef } from "../../../shared/node-types.js";
import { paletteDefs, REGISTRY } from "../../../shared/engine/nodes/index.js";

export type { NodeTemplate, RequiredConfig } from "../../../shared/engine/node-def.js";

/**
 * The palette catalog, one entry per palette-visible node type, derived from the per-node
 * definitions in the registry so a node's presentation and behavior live in one place.
 */
export const PALETTE = paletteDefs.map((d) => d.template);

/** The one-line description for a node type, if one is defined. */
export function describeNode(type: string): string | undefined {
  const desc = REGISTRY[type]?.description;
  return desc ? desc : undefined;
}

/** The trailing empty pin a variadic node grows, if it has one. */
export function trailingVariadic(node: NodeData): PinDef | undefined {
  const last = node.inputs[node.inputs.length - 1];
  return last?.variadic ? last : undefined;
}

/**
 * Promote a node's trailing empty input into a concrete input and append a fresh trailing
 * empty one, so a variadic node always offers exactly one open pin to connect next. The new
 * concrete pin keeps the element type and gets a stable id one past the current highest, so
 * existing wire→pin mappings are never disturbed. Returns the node unchanged when the given
 * pin is not the trailing variadic.
 */
export function growVariadic(node: NodeData, connectedPinId: string): NodeData {
  const trailing = trailingVariadic(node);
  if (!trailing || trailing.id !== connectedPinId) return node;
  const maxIndex = node.inputs.reduce((m, p) => {
    const n = p.id.startsWith("i") ? Number(p.id.slice(1)) : NaN;
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, -1);
  const nextId = `i${maxIndex + 1}`;
  const filled: PinDef = { id: trailing.id, label: "in", type: trailing.type };
  const open: PinDef = { id: nextId, label: "", type: trailing.type, variadic: true };
  return { ...node, inputs: [...node.inputs.slice(0, -1), filled, open] };
}
