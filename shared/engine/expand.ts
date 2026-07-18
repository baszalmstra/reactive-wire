import type { RuntimeNode } from "../runtime-types.js";
import type { ViewEdge } from "./evaluate.js";
import { MACRO_IN, MACRO_OUT, isMacroInstance, type RuntimeMacroMap } from "../macros.js";
import { createRecord, ownValue } from "../record.js";
import { appendPath, pinKey } from "../identity.js";

/**
 * The separator between an instance path and an inner node id in an expanded graph. Inner ids
 * are prefixed with the placement they belong to (recursively for nested macros), so every
 * placement gets its own set of node ids — and therefore its own memory slots in the engine.
 * That is what makes N placements of a stateful macro hold N independent states without any
 * second engine: they are simply N distinct copies of the subgraph after expansion.
 */
export const PATH_SEP = "/";

/** Join an encoded instance path and one raw inner id into a collision-free namespaced id. */
export function joinPath(prefix: string, innerId: string): string {
  return appendPath(prefix, innerId);
}

export interface MacroExpansionLimits {
  maxNodes: number;
  maxEdges: number;
  maxDepth: number;
  maxInstances: number;
}

/** Runtime-wide expansion caps. They apply to the fully inlined graph, not each macro separately. */
export const DEFAULT_MACRO_EXPANSION_LIMITS: Readonly<MacroExpansionLimits> = {
  maxNodes: 10_000,
  maxEdges: 40_000,
  maxDepth: 16,
  maxInstances: 5_000,
};

export class MacroExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroExpansionError";
  }
}

interface ExpansionBudget {
  limits: MacroExpansionLimits;
  instances: number;
}

export interface ExpandResult {
  nodes: RuntimeNode[];
  edges: ViewEdge[];
  /**
   * For each macro placement, how its boundary maps onto expanded node pins, so a caller can
   * read a placement's input/output values back out of the flat results.
   * - outputs: macro output pin id -> the expanded source pin feeding it (or null if unwired).
   * - inputs: macro input pin id -> the expanded macro-in source pin that carries it.
   */
  instances: Record<string, InstanceBinding>;
}

export interface ExpandedEndpoint {
  node: string;
  pin: string;
}

export interface InstanceBinding {
  prefix: string;
  /** Macro output pin id -> expanded pin that produces it. */
  outputs: Record<string, ExpandedEndpoint | null>;
  /** Macro input pin id -> expanded passthrough pin that exposes it. */
  inputs: Record<string, ExpandedEndpoint>;
}

/**
 * The boundary of the macro definition currently being expanded, supplied to expandInto so the
 * single edge-rewrite pass can resolve edges that touch a macro-in or macro-out node. A macro-in
 * pin resolves to its passthrough output; an edge into a macro-out pin records that pin's source
 * as the macro output rather than emitting an edge.
 */
interface BoundaryContext {
  /** Collision-free macro-in pin key -> expanded passthrough output carrying that input. */
  passOut: Record<string, ExpandedEndpoint>;
  /** Ids of macro-in boundary nodes at this level. */
  inIds: Set<string>;
  /** Ids of macro-out boundary nodes at this level. */
  outIds: Set<string>;
  /** The binding being built for this definition; macro-out edges write into its outputs. */
  binding: InstanceBinding;
}

/**
 * Inline every macro placement into a flat graph the engine can evaluate directly. A placement
 * is replaced by a namespaced copy of its definition's subgraph; the placement's external wires
 * are reconnected to the copy's boundary, and the boundary nodes themselves are dropped (their
 * job is done once their pins are spliced into the surrounding wiring).
 *
 * Nesting is handled by recursion with a growing path prefix, and a guard set breaks any macro
 * that (incorrectly) references itself so expansion always terminates.
 */
export function expandMacros(
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  macros: RuntimeMacroMap,
  limits: Readonly<MacroExpansionLimits> = DEFAULT_MACRO_EXPANSION_LIMITS,
  rootIdsArePaths = false,
): ExpandResult {
  const outNodes: RuntimeNode[] = [];
  const outEdges: ViewEdge[] = [];
  const instances = createRecord<InstanceBinding>();
  const budget: ExpansionBudget = { limits: { ...limits }, instances: 0 };
  expandInto(nodes, edges, macros, "", new Set(), outNodes, outEdges, instances, null, budget, 0, rootIdsArePaths);
  return { nodes: outNodes, edges: outEdges, instances };
}

function emitNode(outNodes: RuntimeNode[], node: RuntimeNode, budget: ExpansionBudget): void {
  if (outNodes.length >= budget.limits.maxNodes) {
    throw new MacroExpansionError(`Expanded graph exceeds ${budget.limits.maxNodes} nodes`);
  }
  outNodes.push(node);
}

function emitEdge(outEdges: ViewEdge[], edge: ViewEdge, budget: ExpansionBudget): void {
  if (outEdges.length >= budget.limits.maxEdges) {
    throw new MacroExpansionError(`Expanded graph exceeds ${budget.limits.maxEdges} edges`);
  }
  outEdges.push(edge);
}

function reserveInstance(budget: ExpansionBudget): void {
  budget.instances += 1;
  if (budget.instances > budget.limits.maxInstances) {
    throw new MacroExpansionError(`Expanded graph exceeds ${budget.limits.maxInstances} macro instances`);
  }
}

function expandInto(
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  macros: RuntimeMacroMap,
  prefix: string,
  active: Set<string>,
  outNodes: RuntimeNode[],
  outEdges: ViewEdge[],
  instances: Record<string, InstanceBinding>,
  boundary: BoundaryContext | null,
  budget: ExpansionBudget,
  depth: number,
  rootIdsArePaths: boolean,
): void {
  if (depth > budget.limits.maxDepth) {
    throw new MacroExpansionError(`Macro nesting exceeds depth ${budget.limits.maxDepth}`);
  }
  // Every node id seen at this level, namespaced by the current path. Edges between siblings
  // are rewritten to these ids; edges touching a macro placement are spliced through it.
  const local = (id: string) => prefix || !rootIdsArePaths ? joinPath(prefix, id) : id;

  // Index the macro definitions we will inline so we can resolve their boundary wiring.
  const macroNodes = nodes.filter((n) => isMacroInstance(n.type));
  const macroIds = new Set(macroNodes.map((n) => n.id));

  // Emit every non-macro node with a namespaced id, leaving its pins intact.
  for (const n of nodes) {
    if (isMacroInstance(n.type)) continue;
    emitNode(outNodes, { ...n, id: local(n.id) }, budget);
  }

  // For each placement, recursively expand its definition under an extended path. Record how the
  // definition's boundary pins map to expanded pins so sibling edges can be rerouted through it.
  const bindings = new Map<string, InstanceBinding>();
  for (const inst of macroNodes) {
    reserveInstance(budget);
    const def = ownValue(macros, String(inst.config?.macroId ?? ""));
    const instPath = local(inst.id);
    if (!def || active.has(def.id)) {
      // Unknown macro or a self-reference: leave a binding with no internal pins so external
      // wires resolve to nothing (the placement's outputs read as unavailable) rather than crash.
      bindings.set(inst.id, { prefix: instPath, outputs: createRecord(), inputs: createRecord() });
      continue;
    }
    const binding = expandInstance(def, inst, instPath, macros, active, outNodes, outEdges, instances, budget, depth + 1, rootIdsArePaths);
    bindings.set(inst.id, binding);
    instances[instPath] = binding;
  }

  // Rewrite this level's edges. An edge endpoint on a macro placement is replaced by the
  // expanded pin it stands for: a placement output -> its definition's wired source; a
  // placement input -> the passthrough that carries that input into its subgraph. When this
  // level is the inside of a macro definition, an endpoint on a boundary node is resolved
  // through the boundary context instead: a macro-in pin reads from its passthrough, and an edge
  // into a macro-out pin records its source as the macro's output (no edge is emitted for it).
  for (const e of edges) {
    // An edge feeding a macro-out boundary input defines one of this definition's outputs. Its
    // source is resolved like any other edge source, then stored on the binding rather than
    // emitted, because the macro-out node is dropped and its value is read via the binding.
    if (boundary?.outIds.has(e.to.node)) {
      const src = resolveSource(e.from, macroIds, bindings, boundary, local);
      boundary.binding.outputs[e.to.pin] = src;
      continue;
    }

    const from = resolveSource(e.from, macroIds, bindings, boundary, local);
    const to = resolveTarget(e.to, macroIds, bindings, local);
    if (from && to) {
      emitEdge(outEdges, { id: local(e.id), from, to }, budget);
    }
  }
}

/**
 * Resolve an edge's source endpoint to an expanded pin. A macro placement output reads from the
 * inner pin its definition wired to that output; a macro-in boundary pin reads from the
 * passthrough that carries that input inward; any other node is its own namespaced pin. Returns
 * null when the source resolves to nothing (e.g. an unwired macro output).
 */
function resolveSource(
  from: { node: string; pin: string },
  macroIds: Set<string>,
  bindings: Map<string, InstanceBinding>,
  boundary: BoundaryContext | null,
  local: (id: string) => string,
): { node: string; pin: string } | null {
  if (macroIds.has(from.node)) {
    return bindings.get(from.node)?.outputs[from.pin] ?? null;
  }
  if (boundary?.inIds.has(from.node)) {
    return boundary.passOut[pinKey(from.node, from.pin)] ?? null;
  }
  return { node: local(from.node), pin: from.pin };
}

/**
 * Resolve an edge's target endpoint to an expanded pin. A macro placement input feeds the
 * passthrough that carries that input into its subgraph; any other node is its own namespaced
 * pin. Returns null when the target resolves to nothing (e.g. an unknown macro input).
 */
function resolveTarget(
  to: { node: string; pin: string },
  macroIds: Set<string>,
  bindings: Map<string, InstanceBinding>,
  local: (id: string) => string,
): { node: string; pin: string } | null {
  if (macroIds.has(to.node)) {
    return bindings.get(to.node)?.inputs[to.pin] ?? null;
  }
  return { node: local(to.node), pin: to.pin };
}

/**
 * Expand one macro definition under a path prefix. Returns the boundary binding: how each macro
 * input/output maps onto an expanded pin. The boundary nodes are not emitted as compute nodes —
 * a macro-in pin is realized as a passthrough so the external source flows straight through, and
 * a macro-out input binds to whatever inner pin is wired to it.
 */
function expandInstance(
  def: { id: string; nodes: RuntimeNode[]; edges: ViewEdge[] },
  inst: RuntimeNode,
  instPath: string,
  macros: RuntimeMacroMap,
  active: Set<string>,
  outNodes: RuntimeNode[],
  outEdges: ViewEdge[],
  instances: Record<string, InstanceBinding>,
  budget: ExpansionBudget,
  depth: number,
  rootIdsArePaths: boolean,
): InstanceBinding {
  const nextActive = new Set(active);
  nextActive.add(def.id);

  const inner = def.nodes.filter((n) => n.type !== MACRO_IN && n.type !== MACRO_OUT);
  const boundaryIn = def.nodes.filter((n) => n.type === MACRO_IN);
  const boundaryOut = def.nodes.filter((n) => n.type === MACRO_OUT);

  const binding: InstanceBinding = { prefix: instPath, outputs: createRecord(), inputs: createRecord() };

  // A macro-in node has one output pin per macro input. Each is realized as a passthrough node:
  // the external wire feeding the macro input targets the passthrough's input, and every inner
  // consumer reads from its output, so one source fans out unchanged. An unwired macro input
  // falls back to the literal the placement set on that pin, exactly like a primitive node's
  // editable default — so a literal supplied on a placement flows into its subgraph.
  const passOut = createRecord<ExpandedEndpoint>();
  for (const b of boundaryIn) {
    for (const pin of b.outputs) {
      const passId = joinPath(joinPath(joinPath(instPath, "in"), b.id), pin.id);
      const passPin = "v";
      binding.inputs[pin.id] = { node: passId, pin: passPin };
      passOut[pinKey(b.id, pin.id)] = { node: passId, pin: passPin };
      const literal = inst.values?.[pin.id];
      emitNode(outNodes, passthroughNode(passId, passPin, pin.type, literal), budget);
    }
  }

  // Expand the definition's subgraph under the instance path. The boundary context lets the one
  // edge-rewrite pass resolve every definition edge — including those touching a macro-in or
  // macro-out, and those wiring the boundary directly to a nested macro placement — through the
  // passthroughs and nested bindings, so no edge is left pointing at a dropped boundary node or
  // an already-expanded nested placement.
  const ctx: BoundaryContext = {
    passOut,
    inIds: new Set(boundaryIn.map((n) => n.id)),
    outIds: new Set(boundaryOut.map((n) => n.id)),
    binding,
  };
  expandInto(inner, def.edges, macros, instPath, nextActive, outNodes, outEdges, instances, ctx, budget, depth, rootIdsArePaths);

  // Ensure every declared macro output has an entry, even when nothing is wired to its boundary
  // input (the edge-rewrite pass only writes outputs that have an incoming edge).
  for (const b of boundaryOut) {
    for (const pin of b.inputs) {
      if (!(pin.id in binding.outputs)) binding.outputs[pin.id] = null;
    }
  }

  return binding;
}

/** A two-pin identity node: its output equals its input, used to fan a macro input inward. */
function passthroughNode(
  id: string,
  pin: string,
  type: RuntimeNode["inputs"][number]["type"],
  literal: unknown,
): RuntimeNode {
  return {
    id,
    type: "passthrough",
    inputs: [{ id: pin, label: "", type, editable: literal !== undefined }],
    outputs: [{ id: pin, label: "", type }],
    values: literal === undefined ? undefined : { [pin]: literal },
  };
}
