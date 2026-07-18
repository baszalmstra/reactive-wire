import type { RuntimeNode } from "../runtime-types.js";
import type { RuntimeMacroMap } from "../macros.js";
import { pinKey } from "../identity.js";
import { createRecord } from "../record.js";
import { statePolicy } from "./engine-support.js";
import { expandMacros } from "./expand.js";
import { REGISTRY } from "./nodes/index.js";
import type { ViewEdge } from "./evaluate.js";

export interface CompiledEndpoint {
  node: string;
  pin: string;
}

/** Immutable graph and indexes built once for one deployment/evaluation plan. */
export interface CompiledGraph {
  readonly nodes: RuntimeNode[];
  readonly edges: ViewEdge[];
  readonly nodeById: ReadonlyMap<string, RuntimeNode>;
  readonly incoming: ReadonlyMap<string, CompiledEndpoint>;
  readonly downstream: ReadonlyMap<string, readonly string[]>;
  /** Direct graph roots that observe each Home Assistant entity id. */
  readonly entityRoots: ReadonlyMap<string, readonly string[]>;
  readonly fetchRoots: ReadonlySet<string>;
  readonly clockRoots: ReadonlySet<string>;
  /** Nodes whose outputs expire at the end of every evaluation transaction. */
  readonly transactionRoots: ReadonlySet<string>;
  readonly sinkIds: readonly string[];
  readonly durableNodes: RuntimeNode[];
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as T;
  if (value && typeof value === "object") {
    const out = createRecord<unknown>();
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = cloneJson(item);
    return out as T;
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function append(map: Map<string, string[]>, key: string, value: string): void {
  if (!key) return;
  const values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

/** Expand, detach, freeze, and index a graph exactly once. */
export function compileGraph(
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  macros: RuntimeMacroMap = {},
): CompiledGraph {
  const flat = expandMacros(nodes, edges, macros, undefined, true);
  const ownedNodes = flat.nodes.map((node) => freezeDeep(cloneJson(node)));
  const ownedEdges = flat.edges.map((edge) => freezeDeep(cloneJson(edge)));
  freezeDeep(ownedNodes);
  freezeDeep(ownedEdges);

  const nodeById = new Map(ownedNodes.map((node) => [node.id, node]));
  const incoming = new Map<string, CompiledEndpoint>();
  const downstreamMutable = new Map<string, string[]>();
  for (const node of ownedNodes) downstreamMutable.set(node.id, []);
  for (const edge of ownedEdges) {
    incoming.set(pinKey(edge.to.node, edge.to.pin), edge.from);
    append(downstreamMutable, edge.from.node, edge.to.node);
  }
  const downstream = new Map<string, readonly string[]>();
  for (const [id, values] of downstreamMutable) downstream.set(id, Object.freeze(values));

  const entityMutable = new Map<string, string[]>();
  const fetchRoots = new Set<string>();
  const clockRoots = new Set<string>();
  const transactionRoots = new Set<string>();
  const sinkIds: string[] = [];
  const durableNodes: RuntimeNode[] = [];
  for (const node of ownedNodes) {
    const def = REGISTRY[node.type];
    const entityId = String(node.config?.entity_id ?? "");
    if (node.type === "entity" || def?.evalSink || statePolicy(node.config ?? {}) === "reseed-from-world") {
      append(entityMutable, entityId, node.id);
    }
    if (node.type === "fetch") fetchRoots.add(node.id);
    if (def?.dependsOnClock) clockRoots.add(node.id);
    if (def?.transactionScoped) transactionRoots.add(node.id);
    if (def?.evalSink) sinkIds.push(node.id);
    if (statePolicy(node.config ?? {}) === "durable") durableNodes.push(node);
  }
  const entityRoots = new Map<string, readonly string[]>();
  for (const [id, values] of entityMutable) entityRoots.set(id, Object.freeze(values));

  Object.freeze(sinkIds);
  Object.freeze(durableNodes);
  return Object.freeze({
    nodes: ownedNodes,
    edges: ownedEdges,
    nodeById,
    incoming,
    downstream,
    entityRoots,
    fetchRoots,
    clockRoots,
    transactionRoots,
    sinkIds,
    durableNodes,
  });
}

/** Node-level downstream closure, in deployment order for deterministic transactions. */
export function dirtyClosure(compiled: CompiledGraph, roots: Iterable<string>): Set<string> {
  const dirty = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (!compiled.nodeById.has(root) || dirty.has(root)) continue;
    dirty.add(root);
    queue.push(root);
  }
  for (let i = 0; i < queue.length; i += 1) {
    for (const next of compiled.downstream.get(queue[i]!) ?? []) {
      if (dirty.has(next)) continue;
      dirty.add(next);
      queue.push(next);
    }
  }
  return dirty;
}
