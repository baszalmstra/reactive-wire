import type { Node, Edge, Connection } from "@xyflow/react";
import type { NodeData } from "../../../shared/node-types.js";
import type { ValueType } from "../../../shared/theme.js";
import { TYPE_LABEL } from "../../../shared/theme.js";

export type RWNodeData = { def: NodeData };
export type RWNodeType = Node<RWNodeData, "rw">;

function pinTypeOf(node: RWNodeType, handle: string, side: "source" | "target"): ValueType | undefined {
  const list = side === "source" ? node.data.def.outputs : node.data.def.inputs;
  return list.find((p) => p.id === handle)?.type;
}

/**
 * Two pin types may connect if they match, or either is the unresolved `any`. Each concrete
 * type connects only to its own kind — a Duration feeds only a Duration (or a generic `any` pin
 * that will resolve to Duration), never a plain number, so there is no silent coercion between
 * a dimensionless number and a span of time.
 */
export function typesCompatible(a: ValueType | undefined, b: ValueType | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a === "any" || b === "any";
}

/** Would adding source -> target create a cycle? True if target already reaches source. */
export function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.source) ?? [];
    list.push(e.target);
    adj.set(e.source, list);
  }
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
  }
  return false;
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
  if (wouldCycle(edges, c.source, c.target)) {
    return "That wire would create a cycle — values must flow forward.";
  }
  return null;
}

