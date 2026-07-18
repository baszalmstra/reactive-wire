import type { Node, Edge, Connection } from "@xyflow/react";
import type { NodeData } from "../../../shared/node-types.js";
import type { ValueType } from "../../../shared/theme.js";
import { TYPE_LABEL } from "../../../shared/theme.js";
import { typeGroupConnectionCompatible, typesCompatible, wouldCreateCycle } from "../../../shared/engine/validate-graph.js";

export { typesCompatible } from "../../../shared/engine/validate-graph.js";

export type RWNodeData = { def: NodeData };
export type RWNodeType = Node<RWNodeData, "rw">;

function pinTypeOf(node: RWNodeType, handle: string, side: "source" | "target"): ValueType | undefined {
  const list = side === "source" ? node.data.def.outputs : node.data.def.inputs;
  return list.find((p) => p.id === handle)?.type;
}

/** Would adding source -> target create a cycle? True if target already reaches source. */
export function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  return wouldCreateCycle(edges, source, target);
}

/** A connection is valid when pin types are compatible and it would not create a cycle. */
export function connectionValid(nodes: RWNodeType[], edges: Edge[], c: Connection): boolean {
  return connectionReason(nodes, edges, c) === null;
}

/**
 * Why a connection cannot be made, as a human-readable sentence, or null when it is valid.
 * Mirrors connectionValid's checks so a rejected drag can explain itself instead of failing silently.
 */
export function connectionReason(nodes: RWNodeType[], edges: Edge[], c: Connection): string | null {
  if (!c.source || !c.target || !c.sourceHandle || !c.targetHandle) return null;
  if (c.source === c.target) return "A node cannot wire to itself.";
  const s = nodes.find((n) => n.id === c.source);
  const t = nodes.find((n) => n.id === c.target);
  if (!s || !t) return null;
  const from = pinTypeOf(s, c.sourceHandle, "source");
  const to = pinTypeOf(t, c.targetHandle, "target");
  if (!typesCompatible(from, to)) {
    return `Type mismatch — a ${TYPE_LABEL[from ?? "any"]} pin cannot feed a ${TYPE_LABEL[to ?? "any"]} pin.`;
  }
  const connectedGroupPins = edges.flatMap((edge) => {
    // React Flow replaces the incumbent wire when a connection lands on the same input. Excluding
    // only that wire lets a lone generic input change type while sibling inputs still constrain it.
    if (edge.target !== c.target || edge.targetHandle === c.targetHandle || !edge.targetHandle || !edge.source || !edge.sourceHandle) return [];
    const sourceNode = nodes.find((node) => node.id === edge.source);
    return sourceNode ? [{ pinId: edge.targetHandle, type: pinTypeOf(sourceNode, edge.sourceHandle, "source") }] : [];
  });
  if (!typeGroupConnectionCompatible(t.data.def, c.targetHandle, from, connectedGroupPins)) {
    return "Type mismatch — every connected pin in this generic group must use the same concrete type.";
  }
  if (wouldCycle(edges, c.source, c.target)) {
    return "That wire would create a cycle — values must flow forward.";
  }
  return null;
}

