// This engine and the modules beside it under shared/ are imported by both the editor
// (frontend/src, built by Vite) and the headless server (src/server, run by tsx and
// type-checked by the root tsc). The directory carries no DOM or UI dependencies and
// compiles under the ES2022-only library, so both tsconfigs include shared/ and resolve
// these files through plain relative ".js" imports.
import type { RuntimeNode, RuntimePin, ValueType } from "../runtime-types.js";
import type { EntityMap } from "../entities.js";
import { UN, parseEntityValue, type RWValue } from "../value.js";
import type { EvalResults, SinkAction, ServiceCall } from "../results.js";
import { expandMacros, joinPath } from "./expand.js";
import { isMacroInstance, type RuntimeMacroMap } from "../macros.js";
import { REGISTRY } from "./nodes/index.js";
import type { NodeDef } from "./node-def.js";
import { copyRecord, createRecord, ownValue, setOwn } from "../record.js";
import { isDescendantPath, pinKey } from "../identity.js";
import { compileGraph, dirtyClosure, type CompiledGraph } from "./compile.js";
import {
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
function describeSink(n: RuntimeNode, results: EvalResults): SinkAction {
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
function sinkCommandStatus(n: RuntimeNode, results: EvalResults): SinkAction | null {
  const entityId = String(n.config?.entity_id ?? "");
  // notify/tts target a service name, not an entity; the rest need an entity to act on.
  if (!entityId && n.type !== "sink-notify" && n.type !== "sink-tts") {
    return { call: null, note: "no entity set", status: "unavailable" };
  }
  const cmdPin = REGISTRY[n.type]?.sinkGatePin ?? null;
  if (!cmdPin) return null;
  const cmd = results.inputs[pinKey(n.id, cmdPin)] ?? null;
  if (!cmd || cmd.status === "unavailable") return { call: null, note: `${cmdPin} = unavailable — no call`, status: "unavailable" };
  if (cmd.status === "error") return { call: null, note: `${cmdPin} = error — no call`, status: "error" };
  return null;
}

/** An input pin's ok value, or null if it is unset / non-ok. Used to read a desired dimension. */
function okInput(results: EvalResults, nodeId: string, pinId: string): RWValue | null {
  const v = ownValue(results.inputs, pinKey(nodeId, pinId));
  return v && v.status === "ok" ? v : null;
}

/**
 * Resolve every pin to a current value, reading entity sources from the live entity map.
 * Node definitions propose memory privately; caller memory changes only after a complete successful
 * transaction. Returns a flat map of values
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
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  entities: EntityMap,
  memory: Memory,
  now: number = Date.now(),
  sources: SourceMap = {},
  macros: RuntimeMacroMap = {},
): EvalResults {
  // A graph with macro placements is inlined into a flat graph first: each placement becomes a
  // namespaced copy of its definition's subgraph, so the same single engine evaluates it and
  // every placement gets its own node ids — and therefore its own memory. After evaluating the
  // flat graph, each placement's pins are projected back from the expanded pins they map to, so
  // callers read a macro instance's values exactly as they would any other node's.
  if (nodes.some((n) => isMacroInstance(n.type))) {
    return evaluateWithMacros(nodes, edges, entities, memory, now, sources, macros);
  }
  return evaluateCompiled(compileGraph(nodes, edges), entities, memory, now, sources);
}

/** Results plus operation-count evidence for one retained evaluation transaction. */
export interface EvaluationState {
  results: EvalResults;
  evaluatedNodeIds: readonly string[];
}

/** Evaluate an already-expanded and indexed graph in full. */
export function evaluateCompiled(
  compiled: CompiledGraph,
  entities: EntityMap,
  memory: Memory,
  now: number = Date.now(),
  sources: SourceMap = {},
): EvalResults {
  return evaluateIncremental(compiled, null, null, entities, memory, now, sources).results;
}

/** Recompute a downstream dirty closure while retaining clean results and memory. */
export function evaluateIncremental(
  compiled: CompiledGraph,
  previous: EvalResults | null,
  roots: Iterable<string> | null,
  entities: EntityMap,
  memory: Memory,
  now: number = Date.now(),
  sources: SourceMap = {},
): EvaluationState {
  const dirty = previous && roots !== null
    ? dirtyClosure(compiled, roots)
    : new Set(compiled.nodes.map((node) => node.id));
  if (previous && dirty.size === 0) return { results: previous, evaluatedNodeIds: [] };

  const incoming = compiled.incoming;
  const nodeCache = createRecord<ReturnType<NodeDef["eval"]>>();
  const inCache = createRecord<RWValue | null>();
  const visiting = createRecord<boolean>();
  const pendingMemory = createRecord<NodeMemory>();
  const evaluatedNodeIds: string[] = [];

  function outVal(nodeId: string, pinId: string): RWValue {
    const n = compiled.nodeById.get(nodeId);
    if (!n) return UN("any");
    if (previous && !dirty.has(nodeId)) {
      return ownValue(previous.outputs, pinKey(nodeId, pinId))
        ?? UN(n.outputs.find((pin) => pin.id === pinId)?.type ?? "any");
    }
    const evaluation = computeNode(n);
    return ownValue(evaluation.outputs, pinId) ?? UN(n.outputs.find((p) => p.id === pinId)?.type ?? "any");
  }

  function inVal(nodeId: string, pinId: string): RWValue | null {
    const key = pinKey(nodeId, pinId);
    if (key in inCache) return inCache[key]!;
    const src = incoming.get(key);
    const value = src ? outVal(src.node, src.pin) : null;
    inCache[key] = value;
    return value;
  }

  function resolveType(n: RuntimeNode, declared: ValueType, fallbackPins: string[]): ValueType {
    if (declared !== "any") return declared;
    for (const pinId of fallbackPins) {
      const value = inVal(n.id, pinId);
      if (value && value.type !== "any") return value.type;
    }
    return "any";
  }

  function resolveGroupType(n: RuntimeNode, fallback: ValueType): ValueType {
    for (const pinId of n.typeGroup ?? []) {
      const src = incoming.get(pinKey(n.id, pinId));
      if (!src) continue;
      const value = outVal(src.node, src.pin);
      if (value.type !== "any") return value.type;
    }
    return fallback;
  }

  function effType(n: RuntimeNode, pin: RuntimePin): ValueType {
    if (pin.type !== "any") return pin.type;
    if (n.type === "sink-input" && pin.id === "value") return inputHelperType(n);
    return resolveGroupType(n, "num");
  }

  function inEff(n: RuntimeNode, pinId: string): RWValue | null {
    const pin = n.inputs.find((candidate) => candidate.id === pinId);
    if (!pin) return null;
    if (incoming.has(pinKey(n.id, pinId))) return inVal(n.id, pinId);
    if (!pin.editable) return null;
    const raw = n.values?.[pinId];
    return raw === undefined ? null : parseEntityValue(raw, effType(n, pin));
  }

  function cloneMemoryValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneMemoryValue);
    if (value && typeof value === "object") {
      const clone = createRecord<unknown>();
      for (const [key, item] of Object.entries(value)) setOwn(clone, key, cloneMemoryValue(item));
      return clone;
    }
    return value;
  }

  function cloneMemory(slot: NodeMemory | undefined): NodeMemory {
    return cloneMemoryValue(slot ?? {}) as NodeMemory;
  }

  function booleanSeed(n: RuntimeNode, cfg: Record<string, unknown>): NodeMemory {
    const previousMemory = memoryValue(memory, n.id);
    if (previousMemory?.seeded) return cloneMemory(previousMemory);
    let initial = !!cfg.initial;
    let seeded = true;
    if (statePolicy(cfg) === "reseed-from-world") {
      const entity = entities[String(cfg.entity_id ?? "")];
      const parsed = entity ? parseEntityValue(entity.state, "bool") : null;
      if (parsed?.status === "ok") initial = parsed.v === true;
      else seeded = false;
    }
    const state = seeded || previousMemory === undefined ? initial : previousMemory.state;
    return { state, prev: previousMemory?.prev ?? false, seeded };
  }

  function computeNode(n: RuntimeNode): ReturnType<NodeDef["eval"]> {
    const cached = ownValue(nodeCache, n.id);
    if (cached) return cached;
    if (visiting[n.id]) throw new Error(`Graph cycle reached node ${JSON.stringify(n.id)}`);
    visiting[n.id] = true;
    try {
      const def = REGISTRY[n.type];
      if (!def) {
        const outputs = createRecord<RWValue>();
        for (const pin of n.outputs) setOwn(outputs, pin.id, UN(pin.type));
        const unknown = { outputs };
        setOwn(nodeCache, n.id, unknown);
        evaluatedNodeIds.push(n.id);
        return unknown;
      }
      const cfg = n.config ?? {};
      let seed: NodeMemory | undefined;
      const evaluation = def.eval({
        n,
        cfg,
        conn: n.inputs.filter((pin) => incoming.has(pinKey(n.id, pin.id))),
        inVal: (pinId) => inVal(n.id, pinId),
        inEff: (pinId) => inEff(n, pinId),
        resolveType: (declared, fallbackPins) => resolveType(n, declared, fallbackPins),
        resolveGroupType: (fallback) => resolveGroupType(n, fallback),
        seedBool: () => (seed ??= booleanSeed(n, cfg)),
        previousMemory: Object.freeze(cloneMemory(memoryValue(memory, n.id))),
        entities,
        now,
        sources,
      });
      for (const pin of n.outputs) {
        if (!ownValue(evaluation.outputs, pin.id)) {
          throw new Error(`Node definition ${JSON.stringify(n.type)} omitted declared output ${JSON.stringify(pin.id)}`);
        }
      }
      if (evaluation.nextMemory) setOwn(pendingMemory, n.id, { ...evaluation.nextMemory });
      setOwn(nodeCache, n.id, evaluation);
      evaluatedNodeIds.push(n.id);
      return evaluation;
    } finally {
      visiting[n.id] = false;
    }
  }

  // Incremental transactions collect only dirty entries. They merge into the retained maps only
  // after all node/sink work succeeds, avoiding both whole-map copies and partial failed commits.
  const outputs = createRecord<RWValue>();
  const inputs = createRecord<RWValue | null>();
  const connected = createRecord<boolean>();
  for (const n of compiled.nodes) {
    if (!dirty.has(n.id)) continue;
    computeNode(n);
    for (const pin of n.outputs) outputs[pinKey(n.id, pin.id)] = outVal(n.id, pin.id);
    for (const pin of n.inputs) {
      const key = pinKey(n.id, pin.id);
      inputs[key] = inEff(n, pin.id);
      connected[key] = incoming.has(key);
    }
  }

  const health = createRecord<"ok" | "warn" | "error">();
  for (const n of compiled.nodes) {
    if (!dirty.has(n.id)) continue;
    let nodeHealth: "ok" | "warn" | "error" = "ok";
    for (const pin of n.outputs) {
      const value = outputs[pinKey(n.id, pin.id)];
      if (pin.ghost || value?.status === "error") nodeHealth = "error";
      else if (nodeHealth !== "error" && (value?.status === "unavailable" || value?.status === "stale")) nodeHealth = "warn";
    }
    for (const pin of n.inputs) {
      const value = inputs[pinKey(n.id, pin.id)];
      if (value?.status === "error") nodeHealth = "error";
      else if (nodeHealth === "ok" && (value?.status === "unavailable" || value?.status === "stale")) nodeHealth = "warn";
    }
    health[n.id] = nodeHealth;
  }

  const results: EvalResults = {
    outputs,
    inputs,
    health,
    actions: createRecord<SinkAction>(),
    connected,
    sinks: createRecord<ServiceCall | null>(),
  };
  for (const n of compiled.nodes) {
    if (!dirty.has(n.id)) continue;
    const def = REGISTRY[n.type];
    if (!def?.evalSink) continue;
    let call: ServiceCall | null = null;
    if (!sinkCommandStatus(n, results)) {
      const sink = def.evalSink({
        n,
        cfg: n.config ?? {},
        okInput: (pinId) => okInput(results, n.id, pinId),
        entities,
        previousMemory: Object.freeze(cloneMemory(memoryValue(memory, n.id))),
      });
      call = sink.call;
      if (sink.nextMemory) setOwn(pendingMemory, n.id, { ...sink.nextMemory });
    }
    results.sinks[n.id] = call;
    results.actions[n.id] = describeSink(n, results);
  }

  for (const nodeId of Object.keys(pendingMemory)) setMemoryValue(memory, nodeId, pendingMemory[nodeId]!);
  if (previous) {
    for (const [key, value] of Object.entries(outputs)) setOwn(previous.outputs, key, value);
    for (const [key, value] of Object.entries(inputs)) setOwn(previous.inputs, key, value);
    for (const [key, value] of Object.entries(health)) setOwn(previous.health, key, value);
    for (const [key, value] of Object.entries(results.actions)) setOwn(previous.actions, key, value);
    for (const [key, value] of Object.entries(connected)) setOwn(previous.connected, key, value);
    for (const [key, value] of Object.entries(results.sinks)) setOwn(previous.sinks, key, value);
    return { results: previous, evaluatedNodeIds };
  }
  return { results, evaluatedNodeIds };
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
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  entities: EntityMap,
  memory: Memory,
  now: number,
  sources: SourceMap,
  macros: RuntimeMacroMap,
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
  const incoming = new Set(edges.map((e) => pinKey(e.to.node, e.to.pin)));

  for (const n of nodes) {
    const expandedId = joinPath("", n.id);
    if (!isMacroInstance(n.type)) {
      // Expansion encodes every top-level path segment. Project ordinary nodes back onto their raw
      // public ids too, so raw `a/b` cannot alias the inner node `b` of placement `a`.
      n.outputs.forEach((p) => {
        outputs[pinKey(n.id, p.id)] = inner.outputs[pinKey(expandedId, p.id)] ?? UN(p.type);
      });
      n.inputs.forEach((p) => {
        const publicKey = pinKey(n.id, p.id);
        inputs[publicKey] = inner.inputs[pinKey(expandedId, p.id)] ?? null;
        connected[publicKey] = incoming.has(publicKey);
      });
      health[n.id] = inner.health[expandedId] ?? "warn";
      if (inner.actions[expandedId]) actions[n.id] = inner.actions[expandedId]!;
      if (expandedId in inner.sinks) sinks[n.id] = inner.sinks[expandedId] ?? null;
      continue;
    }
    const binding = flat.instances[expandedId];
    n.outputs.forEach((p) => {
      const src = binding?.outputs[p.id] ?? null;
      outputs[pinKey(n.id, p.id)] = src ? inner.outputs[pinKey(src.node, src.pin)] ?? UN(p.type) : UN(p.type);
    });
    n.inputs.forEach((p) => {
      const pass = binding?.inputs[p.id] ?? null;
      const publicKey = pinKey(n.id, p.id);
      inputs[publicKey] = pass ? inner.inputs[pinKey(pass.node, pass.pin)] ?? null : null;
      connected[publicKey] = incoming.has(publicKey);
    });
    // The placement's health is the worst health of any node inside its expansion.
    let h: "ok" | "warn" | "error" = "ok";
    for (const id in inner.health) {
      if (!isDescendantPath(expandedId, id)) continue;
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
export function sinkCalls(nodes: RuntimeNode[], results: EvalResults): Array<{ nodeId: string; call: ServiceCall }> {
  const out: Array<{ nodeId: string; call: ServiceCall }> = [];
  for (const n of nodes) {
    if (!isSink(n.type)) continue;
    const call = results.sinks[n.id];
    if (call) out.push({ nodeId: n.id, call });
  }
  return out;
}
