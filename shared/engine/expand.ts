import type { NodeData } from "../node-types.js";
import type { ViewEdge } from "./evaluate.js";
import { MACRO_IN, MACRO_OUT, isMacroInstance, type MacroMap } from "../macros.js";
import { createRecord, ownValue } from "../record.js";

/**
 * The separator between an instance path and an inner node id in an expanded graph. Inner ids
 * are prefixed with the placement they belong to (recursively for nested macros), so every
 * placement gets its own set of node ids — and therefore its own memory slots in the engine.
 * That is what makes N placements of a stateful macro hold N independent states without any
 * second engine: they are simply N distinct copies of the subgraph after expansion.
 */
export const PATH_SEP = "/";

/** Join an instance path and an inner id into a namespaced id, e.g. "inst1/toggle". */
export function joinPath(prefix: string, innerId: string): string {
  return prefix ? `${prefix}${PATH_SEP}${innerId}` : innerId;
}

export interface ExpandResult {
  nodes: NodeData[];
  edges: ViewEdge[];
  /**
   * For each macro placement, how its boundary maps onto expanded node pins, so a caller can
   * read a placement's input/output values back out of the flat results.
   * - outputs: macro output pin id -> the expanded source pin feeding it (or null if unwired).
   * - inputs: macro input pin id -> the expanded macro-in source pin that carries it.
   */
  instances: Record<string, InstanceBinding>;
}

export interface InstanceBinding {
  prefix: string;
  /** macro output pin id -> `${node}:${pin}` of the expanded pin that produces it. */
  outputs: Record<string, string | null>;
  /** macro input pin id -> `${node}:${pin}` of the expanded macro-in pin that exposes it. */
  inputs: Record<string, string>;
}

/**
 * The boundary of the macro definition currently being expanded, supplied to expandInto so the
 * single edge-rewrite pass can resolve edges that touch a macro-in or macro-out node. A macro-in
 * pin resolves to its passthrough output; an edge into a macro-out pin records that pin's source
 * as the macro output rather than emitting an edge.
 */
interface BoundaryContext {
  /** macro-in `${node}:${pin}` -> the expanded passthrough output that carries that input. */
  passOut: Record<string, { node: string; pin: string }>;
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
export function expandMacros(nodes: NodeData[], edges: ViewEdge[], macros: MacroMap): ExpandResult {
  const outNodes: NodeData[] = [];
  const outEdges: ViewEdge[] = [];
  const instances = createRecord<InstanceBinding>();
  expandInto(nodes, edges, macros, "", new Set(), outNodes, outEdges, instances, null);
  return { nodes: outNodes, edges: outEdges, instances };
}

function expandInto(
  nodes: NodeData[],
  edges: ViewEdge[],
  macros: MacroMap,
  prefix: string,
  active: Set<string>,
  outNodes: NodeData[],
  outEdges: ViewEdge[],
  instances: Record<string, InstanceBinding>,
  boundary: BoundaryContext | null,
): void {
  // Every node id seen at this level, namespaced by the current path. Edges between siblings
  // are rewritten to these ids; edges touching a macro placement are spliced through it.
  const local = (id: string) => joinPath(prefix, id);

  // Index the macro definitions we will inline so we can resolve their boundary wiring.
  const macroNodes = nodes.filter((n) => isMacroInstance(n.type));
  const macroIds = new Set(macroNodes.map((n) => n.id));

  // Emit every non-macro node with a namespaced id, leaving its pins intact.
  for (const n of nodes) {
    if (isMacroInstance(n.type)) continue;
    outNodes.push({ ...n, id: local(n.id) });
  }

  // For each placement, recursively expand its definition under an extended path. Record how the
  // definition's boundary pins map to expanded pins so sibling edges can be rerouted through it.
  const bindings = new Map<string, InstanceBinding>();
  for (const inst of macroNodes) {
    const def = ownValue(macros, String(inst.config?.macroId ?? ""));
    const instPath = local(inst.id);
    if (!def || active.has(def.id)) {
      // Unknown macro or a self-reference: leave a binding with no internal pins so external
      // wires resolve to nothing (the placement's outputs read as unavailable) rather than crash.
      bindings.set(inst.id, { prefix: instPath, outputs: createRecord(), inputs: createRecord() });
      continue;
    }
    const binding = expandInstance(def, inst, instPath, macros, active, outNodes, outEdges, instances);
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
      boundary.binding.outputs[e.to.pin] = src ? `${src.node}:${src.pin}` : null;
      continue;
    }

    const from = resolveSource(e.from, macroIds, bindings, boundary, local);
    const to = resolveTarget(e.to, macroIds, bindings, local);
    if (from && to) {
      outEdges.push({ id: local(e.id), from, to });
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
    const src = bindings.get(from.node)?.outputs[from.pin] ?? null;
    return src ? splitPin(src) : null;
  }
  if (boundary?.inIds.has(from.node)) {
    return boundary.passOut[`${from.node}:${from.pin}`] ?? null;
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
    const inPin = bindings.get(to.node)?.inputs[to.pin] ?? null;
    return inPin ? splitPin(inPin) : null;
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
  def: { id: string; nodes: NodeData[]; edges: ViewEdge[] },
  inst: NodeData,
  instPath: string,
  macros: MacroMap,
  active: Set<string>,
  outNodes: NodeData[],
  outEdges: ViewEdge[],
  instances: Record<string, InstanceBinding>,
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
  const passOut = createRecord<{ node: string; pin: string }>();
  for (const b of boundaryIn) {
    for (const pin of b.outputs) {
      const passId = joinPath(instPath, `in${PATH_SEP}${b.id}${PATH_SEP}${pin.id}`);
      const passPin = "v";
      binding.inputs[pin.id] = `${passId}:${passPin}`;
      passOut[`${b.id}:${pin.id}`] = { node: passId, pin: passPin };
      const literal = inst.values?.[pin.id];
      outNodes.push(passthroughNode(passId, passPin, pin.type, literal));
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
  expandInto(inner, def.edges, macros, instPath, nextActive, outNodes, outEdges, instances, ctx);

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
  type: NodeData["inputs"][number]["type"],
  literal: unknown,
): NodeData {
  return {
    id,
    type: "passthrough",
    title: "",
    subtitle: "",
    icon: "macro",
    x: 0,
    y: 0,
    inputs: [{ id: pin, label: "", type, editable: literal !== undefined }],
    outputs: [{ id: pin, label: "", type }],
    values: literal === undefined ? undefined : { [pin]: literal },
  };
}

/** Split a `${node}:${pin}` key back into its parts. */
function splitPin(key: string): { node: string; pin: string } {
  const i = key.lastIndexOf(":");
  return { node: key.slice(0, i), pin: key.slice(i + 1) };
}
