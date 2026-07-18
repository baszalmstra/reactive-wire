// This engine and the modules beside it under shared/ are imported by both the editor
// (frontend/src, built by Vite) and the headless server (src/server, run by tsx and
// type-checked by the root tsc). The directory carries no DOM or UI dependencies and
// compiles under the ES2022-only library, so both tsconfigs include shared/ and resolve
// these files through plain relative ".js" imports.
import type { NodeData, PinDef } from "../node-types.js";
import type { ValueType } from "../theme.js";
import type { EntityMap } from "../entities.js";
import { UN, ER, parseEntityValue, type RWValue } from "../value.js";
import type { EvalResults, SinkAction, ServiceCall } from "../results.js";
import { expandMacros } from "./expand.js";
import { isMacroInstance, type MacroMap } from "../macros.js";
import { REGISTRY } from "./nodes/index.js";
import type { EvalCtx, NodeDef, SinkCtx } from "./node-def.js";
import { copyRecord, createRecord, ownValue, setOwn } from "../record.js";
import {
  ensureMemoryValue,
  inputHelperType,
  memoryValue,
  setMemoryValue,
  statePolicy,
  type Memory,
  type NodeMemory,
  type SourceMap,
} from "./engine-support.js";

export type { ServiceCall } from "../results.js";
export type { Memory, NodeMemory, SourceMap, SourceResult, StatePolicy } from "./engine-support.js";

export interface ViewEdge {
  id: string;
  from: { node: string; pin: string };
  to: { node: string; pin: string };
}

/** Whether a node type names a sink that actuates Home Assistant. */
export function isSink(type: string): boolean {
  return REGISTRY[type]?.evalSink !== undefined;
}

/**
 * Whether a sink is an edge-triggered transient (a fire-and-forget effect with no queryable
 * state, like notify or TTS). The engine already gates these to fire once per change, so the
 * caller must not also de-dupe identical consecutive calls — an A→B→A message sequence is two
 * genuine announcements, not a repeat to suppress.
 */
export function isTransientSink(type: string): boolean {
  return REGISTRY[type]?.transient === true;
}

/** A short text summary of a service call for the canvas preview. */
function callNote(call: ServiceCall): string {
  const keys = Object.keys(call.data);
  const args = keys.length ? ` ${keys.map((k) => `${k}=${JSON.stringify(call.data[k])}`).join(", ")}` : "";
  const target = call.target?.entity_id ? `${call.target.entity_id}${args}` : args.trim();
  return `${call.domain}.${call.service}(${target})`;
}

/**
 * The preview text and status for a sink, read from the call already computed for it during
 * this recompute. A sink whose command input is non-ok produces no call and a note explaining
 * why, so the editor shows "holds" rather than a fabricated action; a sink that has nothing to
 * change (desired already matches actual) reads as a no-op.
 */
function describeSink(n: NodeData, results: EvalResults): SinkAction {
  const blocked = sinkCommandStatus(n, results);
  if (blocked) return blocked;
  const call = results.sinks[n.id];
  if (!call) return { call: null, note: "holds — no change", status: "ok" };
  return { call: callNote(call), status: "ok" };
}

/**
 * If a sink can't actuate because of its gating command input, the reason. Returns null when
 * the gate is clear (or the sink has no single gate). Centralizes the safety rule so the
 * preview note and the real call agree: a missing entity, or a command input that is
 * unavailable/errored, blocks the call entirely.
 */
function sinkCommandStatus(n: NodeData, results: EvalResults): SinkAction | null {
  const entityId = String(n.config?.entity_id ?? "");
  // notify/tts target a service name, not an entity; the rest need an entity to act on.
  if (!entityId && n.type !== "sink-notify" && n.type !== "sink-tts") {
    return { call: null, note: "no entity set", status: "unavailable" };
  }
  const cmdPin = REGISTRY[n.type]?.sinkGatePin ?? null;
  if (!cmdPin) return null;
  const cmd = results.inputs[`${n.id}:${cmdPin}`] ?? null;
  if (!cmd || cmd.status === "unavailable") return { call: null, note: `${cmdPin} = unavailable — no call`, status: "unavailable" };
  if (cmd.status === "error") return { call: null, note: `${cmdPin} = error — no call`, status: "error" };
  return null;
}

/** An input pin's ok value, or null if it is unset / non-ok. Used to read a desired dimension. */
function okInput(results: EvalResults, nodeId: string, pinId: string): RWValue | null {
  const v = ownValue(results.inputs, `${nodeId}:${pinId}`);
  return v && v.status === "ok" ? v : null;
}

/**
 * Build the service call a sink wants to make right now, or null if it should hold. The decision
 * — the safety rule (never act on a non-ok desired value) and each reconciling diff — lives in
 * the sink's own definition; here the engine gates on the command status, then hands the sink an
 * already-resolved input reader, the entity map, and its memory slot. Edge-triggered sinks
 * (notify/tts) advance their per-node memory in evalSink, so it must be called exactly once.
 */
function buildSinkCall(n: NodeData, def: NodeDef, results: EvalResults, entities: EntityMap, memory: Memory): ServiceCall | null {
  if (sinkCommandStatus(n, results)) return null;
  if (!def.evalSink) return null;
  const ctx: SinkCtx = {
    n,
    cfg: n.config ?? {},
    okInput: (pinId) => okInput(results, n.id, pinId),
    entities,
    mem: () => ensureMemoryValue(memory, n.id),
  };
  return def.evalSink(ctx);
}

/**
 * Resolve every pin to a current value, reading entity sources from the live entity map.
 * Pure except that `memory` is mutated for stateful nodes. Returns a flat map of values
 * plus per-node health and sink actions.
 *
 * Time is supplied as an explicit input (`now`, epoch milliseconds) rather than read from a
 * global clock, so the same call is deterministic and reproducible: callers that want the
 * graph to advance as wall-clock time passes recompute on an interval and pass a fresh `now`
 * each time, while tests pass a fixed value. The server drives this tick on a timer, the
 * editor's preview passes its simulated clock, and an omitted `now` falls back to the current
 * time so a caller that never deals in durations needn't supply one.
 *
 * Async data-source results are supplied the same way through `sources`: a poller outside the
 * engine fetches and writes the latest body per node id, and this recompute reads it. An
 * omitted map (e.g. the editor preview, which has no poller) leaves every source unavailable,
 * so those nodes degrade to a still-loading value rather than breaking.
 */
export function evaluate(
  nodes: NodeData[],
  edges: ViewEdge[],
  entities: EntityMap,
  memory: Memory,
  now: number = Date.now(),
  sources: SourceMap = {},
  macros: MacroMap = {},
): EvalResults {
  // A graph with macro placements is inlined into a flat graph first: each placement becomes a
  // namespaced copy of its definition's subgraph, so the same single engine evaluates it and
  // every placement gets its own node ids — and therefore its own memory. After evaluating the
  // flat graph, each placement's pins are projected back from the expanded pins they map to, so
  // callers read a macro instance's values exactly as they would any other node's.
  if (nodes.some((n) => isMacroInstance(n.type))) {
    return evaluateWithMacros(nodes, edges, entities, memory, now, sources, macros);
  }
  const byId = createRecord<NodeData>();
  for (const n of nodes) setOwn(byId, n.id, n);
  const incoming = createRecord<{ node: string; pin: string }>();
  edges.forEach((e) => {
    setOwn(incoming, `${e.to.node}:${e.to.pin}`, e.from);
  });
  const outCache = createRecord<RWValue>();
  const inCache = createRecord<RWValue | null>();
  const visiting = createRecord<boolean>();

  function outVal(nodeId: string, pinId: string): RWValue {
    const key = `${nodeId}:${pinId}`;
    if (key in outCache) return outCache[key]!;
    if (visiting[key]) return ER("any", "cycle");
    visiting[key] = true;
    const n = ownValue(byId, nodeId);
    const v = n ? computeOut(n, pinId) : UN("any");
    visiting[key] = false;
    outCache[key] = v;
    return v;
  }

  function inVal(nodeId: string, pinId: string): RWValue | null {
    const key = `${nodeId}:${pinId}`;
    if (key in inCache) return inCache[key]!;
    const src = incoming[key];
    const v = src ? outVal(src.node, src.pin) : null;
    inCache[key] = v;
    return v;
  }

  function resolveType(n: NodeData, declared: ValueType, fallbackPins: string[]): ValueType {
    if (declared !== "any") return declared;
    for (const pid of fallbackPins) {
      const iv = inVal(n.id, pid);
      if (iv && iv.type !== "any") return iv.type;
    }
    return "any";
  }

  // The shared type of a node's generic pins, taken from whichever group pin is connected.
  function resolveGroupType(n: NodeData, fallback: ValueType): ValueType {
    for (const pid of n.typeGroup ?? []) {
      const src = incoming[`${n.id}:${pid}`];
      if (src) {
        const v = outVal(src.node, src.pin);
        if (v.type !== "any") return v.type;
      }
    }
    return fallback;
  }
  function effType(n: NodeData, pin: PinDef): ValueType {
    if (pin.type !== "any") return pin.type;
    // An input-helper sink's value pin takes whatever type the target helper holds, so its
    // editable default parses to match (a string for input_text/input_select, etc.).
    if (n.type === "sink-input" && pin.id === "value") return inputHelperType(n);
    return resolveGroupType(n, "num");
  }
  // An input pin's effective value: the wired value if connected, else its editable default.
  function inEff(n: NodeData, pinId: string): RWValue | null {
    const pin = n.inputs.find((p) => p.id === pinId);
    if (!pin) return null;
    if (incoming[`${n.id}:${pinId}`]) return inVal(n.id, pinId);
    if (pin.editable) {
      // An unset editable default is "not provided" (null), not unavailable — so it neither
      // actuates nor counts against the node's health.
      const raw = n.values?.[pinId];
      return raw === undefined ? null : parseEntityValue(raw, effType(n, pin));
    }
    return null;
  }

  // Establish (once) and return a boolean stateful node's memory slot. The initial value
  // comes from the node's config, except under "reseed-from-world" where it is read from the
  // configured entity's current state so the node boots aligned with the real world.
  function seedBool(n: NodeData, cfg: Record<string, unknown>): NodeMemory {
    let mem = memoryValue(memory, n.id);
    if (mem && mem.seeded) return mem;
    let initial = !!cfg.initial;
    // Under reseed-from-world, defer marking the slot seeded until the configured entity is
    // present and ok, so a node that boots before its entity arrives reseeds once it appears
    // rather than locking onto the config fallback forever.
    let seeded = true;
    if (statePolicy(cfg) === "reseed-from-world") {
      const e = entities[String(cfg.entity_id ?? "")];
      const parsed = e ? parseEntityValue(e.state, "bool") : null;
      if (parsed && parsed.status === "ok") initial = parsed.v === true;
      else seeded = false;
    }
    // While not yet seeded the slot tracks the (still-config) fallback; once the world value
    // arrives it overrides, so the state isn't frozen on a pre-seed fallback.
    const state = seeded || mem === undefined ? initial : mem.state;
    mem = { state, prev: mem?.prev ?? false, seeded };
    return setMemoryValue(memory, n.id, mem);
  }

  // Resolve one output pin by dispatching to its node definition with a context that carries
  // already-resolved inputs and the shared machinery. An unknown node type reads as unavailable.
  function computeOut(n: NodeData, pinId: string): RWValue {
    const def = REGISTRY[n.type];
    if (!def) return UN("any");
    const cfg = n.config ?? {};
    const ctx: EvalCtx = {
      n,
      pinId,
      cfg,
      conn: n.inputs.filter((p) => incoming[`${n.id}:${p.id}`]),
      inVal: (pid) => inVal(n.id, pid),
      inEff: (pid) => inEff(n, pid),
      resolveType: (declared, fallbackPins) => resolveType(n, declared, fallbackPins),
      resolveGroupType: (fallback) => resolveGroupType(n, fallback),
      seedBool: () => seedBool(n, cfg),
      mem: () => ensureMemoryValue(memory, n.id),
      entities,
      now,
      sources,
    };
    return def.eval(ctx);
  }

  const outputs = createRecord<RWValue>();
  const inputs = createRecord<RWValue | null>();
  const connected = createRecord<boolean>();
  nodes.forEach((n) => {
    n.outputs.forEach((p) => { outputs[`${n.id}:${p.id}`] = outVal(n.id, p.id); });
    n.inputs.forEach((p) => {
      inputs[`${n.id}:${p.id}`] = inEff(n, p.id);
      connected[`${n.id}:${p.id}`] = !!incoming[`${n.id}:${p.id}`];
    });
  });

  const health = createRecord<"ok" | "warn" | "error">();
  nodes.forEach((n) => {
    let h: "ok" | "warn" | "error" = "ok";
    n.outputs.forEach((p) => {
      const v = outputs[`${n.id}:${p.id}`];
      if (p.ghost || (v && v.status === "error")) h = "error";
      else if (h !== "error" && v && (v.status === "unavailable" || v.status === "stale")) h = "warn";
    });
    n.inputs.forEach((p) => {
      const v = inputs[`${n.id}:${p.id}`];
      if (v && v.status === "error") h = "error";
      else if (h === "ok" && v && (v.status === "unavailable" || v.status === "stale")) h = "warn";
    });
    health[n.id] = h;
  });

  const results: EvalResults = {
    outputs,
    inputs,
    health,
    actions: createRecord<SinkAction>(),
    connected,
    sinks: createRecord<ServiceCall | null>(),
  };
  // Compute each sink's desired call once (advancing edge-triggered sinks' memory exactly
  // once), then derive its preview note from that same call so display and actuation agree.
  nodes.forEach((n) => {
    const def = REGISTRY[n.type];
    if (!def?.evalSink) return;
    results.sinks[n.id] = buildSinkCall(n, def, results, entities, memory);
    results.actions[n.id] = describeSink(n, results);
  });

  return results;
}

/**
 * Evaluate a graph that contains macro placements by inlining them into a flat subgraph, running
 * the same engine over it, then projecting the flat results back onto the original node ids.
 *
 * The flat results already carry every inner pin (namespaced by placement), which is exactly the
 * per-placement state isolation we want — two placements of a stateful macro evaluate as two
 * disjoint copies, so their memory slots never collide. The projection adds, for each placement:
 * its output pins (read from the inner pins their macro-out boundary binds to), its input pins
 * (read from the passthrough that carries each macro input inward), a health roll-up over the
 * placement's whole subgraph, and any inner sink actions surfaced under the placement.
 */
function evaluateWithMacros(
  nodes: NodeData[],
  edges: ViewEdge[],
  entities: EntityMap,
  memory: Memory,
  now: number,
  sources: SourceMap,
  macros: MacroMap,
): EvalResults {
  const flat = expandMacros(nodes, edges, macros);
  const inner = evaluate(flat.nodes, flat.edges, entities, memory, now, sources, macros);

  const outputs = copyRecord(inner.outputs);
  const inputs = copyRecord(inner.inputs);
  const connected = copyRecord(inner.connected);
  const health = copyRecord(inner.health);
  const actions = copyRecord(inner.actions);
  const sinks = copyRecord(inner.sinks);

  // Whether an input pin has an incoming edge, taken from the original graph (the placement's
  // own wiring), since the flat graph routes inputs through passthrough nodes.
  const incoming = new Set(edges.map((e) => `${e.to.node}:${e.to.pin}`));

  for (const n of nodes) {
    if (!isMacroInstance(n.type)) continue;
    const binding = flat.instances[n.id];
    n.outputs.forEach((p) => {
      const src = binding?.outputs[p.id] ?? null;
      outputs[`${n.id}:${p.id}`] = src ? inner.outputs[src] ?? UN(p.type) : UN(p.type);
    });
    n.inputs.forEach((p) => {
      const pass = binding?.inputs[p.id] ?? null;
      inputs[`${n.id}:${p.id}`] = pass ? inner.inputs[pass] ?? null : null;
      connected[`${n.id}:${p.id}`] = incoming.has(`${n.id}:${p.id}`);
    });
    // The placement's health is the worst health of any node inside its expansion.
    const prefix = `${n.id}/`;
    let h: "ok" | "warn" | "error" = "ok";
    for (const id in inner.health) {
      if (id !== n.id && !id.startsWith(prefix)) continue;
      const ih = inner.health[id]!;
      if (ih === "error") h = "error";
      else if (ih === "warn" && h === "ok") h = "warn";
    }
    health[n.id] = h;
  }

  return { outputs, inputs, health, actions, connected, sinks };
}

/**
 * The service calls a graph's sinks want to make right now. The decision (including the safety
 * rule — never actuate on a non-ok desired value — and each reconciling diff) was already made
 * during evaluate and recorded in `results.sinks`; this just collects the non-null calls. A
 * sink that holds (non-ok command, or desired already matches actual) contributes nothing.
 *
 * Sinks inside macro placements are inlined into the flat graph and so are collected here under
 * their namespaced ids; the caller resolves the type via its own node map, which after expansion
 * holds those inner sink nodes too.
 */
export function sinkCalls(nodes: NodeData[], results: EvalResults): Array<{ nodeId: string; call: ServiceCall }> {
  const out: Array<{ nodeId: string; call: ServiceCall }> = [];
  for (const n of nodes) {
    if (!isSink(n.type)) continue;
    const call = results.sinks[n.id];
    if (call) out.push({ nodeId: n.id, call });
  }
  return out;
}
