import type { NodeData, PinDef } from "./node-types.js";
import type { ViewEdge } from "./engine/evaluate.js";

/**
 * A macro is a reusable subgraph with a typed boundary. Its inner graph is plain nodes and
 * edges, the same shape the engine already evaluates; two special boundary node types carry
 * the macro's external pins:
 *
 * - "macro-in" — one output pin per macro input; inner wires read the value fed from outside.
 * - "macro-out" — one input pin per macro output; whatever is wired in becomes the macro's
 *   output value.
 *
 * The macro is therefore just a subgraph, so it inherits the engine's reactive semantics by
 * being inlined at evaluate time rather than run by a second engine. A macro that contains any
 * stateful node is itself stateful.
 */
export interface MacroDef {
  /** Stable identifier referenced by every placement and by nested dependencies. */
  id: string;
  name: string;
  /** External input pins, exposed in the order they appear on a placement. */
  inputs: PinDef[];
  /** External output pins. */
  outputs: PinDef[];
  /** The inner subgraph: plain nodes (including the boundary nodes) and edges. */
  nodes: NodeData[];
  edges: ViewEdge[];
  /** True if any inner node (or nested macro) carries memory. */
  stateful: boolean;
}

/** A library of macro definitions keyed by id, the form the engine and editor consume. */
export type MacroMap = Record<string, MacroDef>;

export const MACRO_IN = "macro-in";
export const MACRO_OUT = "macro-out";

/** Whether a node type is a macro placement (an instance of a macro definition). */
export function isMacroInstance(type: string): boolean {
  return type === "macro";
}

/** Whether a node is one of the boundary nodes that live only inside a definition canvas. */
export function isBoundary(type: string): boolean {
  return type === MACRO_IN || type === MACRO_OUT;
}

/**
 * Whether a macro definition contains memory anywhere in its (possibly nested) subgraph, so a
 * placement can carry the "has memory" badge. Recurses into nested macro instances using the
 * supplied library; a missing dependency is treated as stateless.
 */
export function macroHasMemory(def: MacroDef, macros: MacroMap, seen: Set<string> = new Set()): boolean {
  if (seen.has(def.id)) return false;
  seen.add(def.id);
  for (const n of def.nodes) {
    if (n.stateful) return true;
    if (isMacroInstance(n.type)) {
      const inner = macros[String(n.config?.macroId ?? "")];
      if (inner && macroHasMemory(inner, macros, seen)) return true;
    }
  }
  return false;
}

let macroSeq = 0;
/** A fresh macro id, unique within a session. */
export function newMacroId(): string {
  macroSeq += 1;
  return `macro_${Date.now().toString(36)}_${macroSeq}`;
}

/**
 * Build a placement (instance) node for a macro. The placement mirrors the macro's boundary
 * pins so it wires like any other node; its config records which definition it instantiates.
 * Editable inputs let a placement supply a literal for an unconnected input, exactly as a
 * primitive node does.
 */
export function makeMacroInstance(def: MacroDef, id: string, x: number, y: number): NodeData {
  return {
    id,
    type: "macro",
    title: def.name,
    subtitle: "Macro",
    icon: "macro",
    x,
    y,
    w: 220,
    stateful: def.stateful,
    config: { macroId: def.id },
    inputs: def.inputs.map((p) => ({ ...p, editable: true })),
    outputs: def.outputs.map((p) => ({ ...p })),
  };
}
