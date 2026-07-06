import { evaluate, isSink, sinkCalls, type Memory, type ViewEdge } from "../../shared/engine/evaluate.js";
import { expandMacros } from "../../shared/engine/expand.js";
import type { MacroMap } from "../../shared/macros.js";
import type { Health, NodeData } from "../../shared/node-types.js";
import type { EntityMap } from "../../shared/entities.js";
import type { EvalResults, ServiceCall } from "../../shared/results.js";
import type { RWValue } from "../../shared/value.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { log } from "./log.js";
import { Poller, type FetchFn } from "./poller.js";

/** A pin value flattened for a debugState response: its type, status, and a JSON-safe value. */
export interface DebugValue {
  type: string;
  status: string;
  value: unknown;
  msg?: string;
}

/** A node's latest health and output values, as surfaced over debugState. */
export interface DebugNode {
  type: string;
  health: Health;
  outputs: Record<string, DebugValue>;
}

/** A sink's latest desired call and reconciliation bookkeeping, as surfaced over debugState. */
export interface DebugSink {
  /** The service call the sink wants to make right now, or null when it holds. */
  desired: ServiceCall | null;
  note?: string;
  status: string;
  /** Whether an identical call is currently awaiting a service response. */
  inFlight: boolean;
  /** For generic call-service sinks, the last command remembered until its desired value changes. */
  lastCommand: string | null;
}

/** A read-only snapshot of the Deployer's runtime state for introspection. */
export interface DeployerSnapshot {
  deployed: boolean;
  generation: number;
  mode: "live" | "dry-run";
  /** Epoch ms of the last recompute, or null if the graph has never run. */
  evaluatedAt: number | null;
  nodes: Record<string, DebugNode>;
  sinks: Record<string, DebugSink>;
}

/** A value that survives JSON serialization, or its string form when it would throw (circular, BigInt). */
function jsonSafe(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

/** Flatten a runtime value to a JSON-safe shape; arbitrary values fall back to their string form. */
function debugValue(v: RWValue): DebugValue {
  const value = jsonSafe(v.v);
  return v.msg ? { type: v.type, status: v.status, value, msg: v.msg } : { type: v.type, status: v.status, value };
}

/**
 * A sink's desired service call flattened for a debugState response. The call's `data` is arbitrary
 * JSON, so each field is passed through the same JSON-safe guard as node output values — a circular
 * or otherwise unserializable value deployed into sink data can't break the response frame.
 */
function debugCall(call: ServiceCall): ServiceCall {
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.data)) data[k] = jsonSafe(v);
  return call.target
    ? { domain: call.domain, service: call.service, data, target: call.target }
    : { domain: call.domain, service: call.service, data };
}

/** A no-op fetch used when no real one is supplied; every fetch source then stays unavailable. */
const noFetch: FetchFn = () => Promise.reject(new Error("no fetch configured"));

/**
 * Persistence for the memory slots of nodes declaring the "durable" state policy: restored into a
 * fresh memory on deploy and captured after each tick, so accumulated history survives a restart.
 */
export interface DurableMemory {
  /** Seed durable slots into a freshly cleared memory for the given graph. */
  restore(nodes: NodeData[], mem: Memory): void;
  /** Record the current durable slots after a recompute. */
  capture(nodes: NodeData[], mem: Memory): void;
  /** Flush any pending write and release resources. */
  stop(): void;
}

/**
 * Runs a deployed graph with the same engine the editor previews with: on every entity
 * change it re-evaluates and reconciles each sink, calling a service whenever the actual
 * state differs from the desired state. Sinks whose command input is not a concrete value are skipped, so an offline
 * input can never actuate. In preview mode calls are logged instead of executed.
 *
 * Async data-source (fetch) nodes are driven by a Poller at the edge: it fetches each source
 * on its interval and writes the latest body into a source map, then triggers a recompute. The
 * core recompute itself stays synchronous and simply reads those last values.
 */
export class Deployer {
  private graph: { nodes: NodeData[]; edges: ViewEdge[] } | null = null;
  private mem: Memory = {};
  private actuate = false;
  private generation = 0;
  private readonly inFlight = new Map<string, string>();
  private readonly lastNonReconciling = new Map<string, string>();
  private readonly tick: ReturnType<typeof setInterval>;
  private readonly poller: Poller;
  private lastResults: EvalResults | null = null;
  private lastRunAt: number | null = null;

  constructor(
    private readonly ha: HAClient & EntityFeed,
    tickMs = 1000,
    fetchFn: FetchFn = noFetch,
    private readonly durable?: DurableMemory,
  ) {
    ha.onEntities(() => this.run());
    this.poller = new Poller(fetchFn, () => this.run());
    // A clock tick re-evaluates on a fixed interval so derivations that depend on time (now,
    // elapsed durations) advance even when no entity changes — without it, "open for 10 min"
    // would only re-check when some other entity happened to report a change.
    this.tick = setInterval(() => this.run(), tickMs);
  }

  /**
   * Deploy a graph. Macro placements are inlined into a flat subgraph first (the same expansion
   * the editor preview uses), so the single engine runs over plain nodes and every sink — including
   * those inside macros — is reconciled, with each placement's state kept separate by its namespaced
   * ids. When `actuate` is true sinks call services; otherwise they dry-run.
   */
  deploy(nodes: NodeData[], edges: ViewEdge[], actuate: boolean, macros: MacroMap = {}): void {
    const flat = expandMacros(nodes, edges, macros);
    this.generation += 1;
    this.inFlight.clear();
    this.lastNonReconciling.clear();
    this.graph = { nodes: flat.nodes, edges: flat.edges };
    this.actuate = actuate;
    this.mem = {};
    // Durable slots are restored before the first run so an accumulated fold/scan resumes from its
    // persisted history rather than reseeding; stale slots for departed nodes are dropped here.
    this.durable?.restore(flat.nodes, this.mem);
    this.poller.start(flat.nodes);
    this.run();
  }

  /** Stop the clock tick and all source polling. */
  stop(): void {
    this.generation += 1;
    this.inFlight.clear();
    this.lastNonReconciling.clear();
    clearInterval(this.tick);
    this.poller.stop();
    this.durable?.stop();
  }

  /**
   * A read-only snapshot of the current runtime state: whether a graph is deployed, its generation
   * and mode, every node's latest health and output values, and each sink's desired call plus its
   * in-flight/remembered reconciliation state. Values are flattened to a JSON-safe shape so the
   * snapshot can be serialized straight onto a debug response.
   */
  inspect(): DeployerSnapshot {
    const graph = this.graph;
    const results = this.lastResults;
    const nodes: Record<string, DebugNode> = {};
    const sinks: Record<string, DebugSink> = {};
    if (graph && results) {
      for (const n of graph.nodes) {
        const outputs: Record<string, DebugValue> = {};
        for (const p of n.outputs) {
          const v = results.outputs[`${n.id}:${p.id}`];
          if (v) outputs[p.id] = debugValue(v);
        }
        nodes[n.id] = { type: n.type, health: results.health[n.id] ?? "ok", outputs };
        if (isSink(n.type)) {
          const action = results.actions[n.id];
          const desired = results.sinks[n.id];
          sinks[n.id] = {
            desired: desired ? debugCall(desired) : null,
            note: action?.note,
            status: action?.status ?? "ok",
            inFlight: this.inFlight.has(n.id),
            lastCommand: this.lastNonReconciling.get(n.id) ?? null,
          };
        }
      }
    }
    return {
      deployed: graph !== null,
      generation: this.generation,
      mode: this.actuate ? "live" : "dry-run",
      evaluatedAt: this.lastRunAt,
      nodes,
      sinks,
    };
  }

  private run(): void {
    if (!this.graph) return;
    const entities: EntityMap = this.ha.entitiesSnapshot();
    const results = evaluate(this.graph.nodes, this.graph.edges, entities, this.mem, Date.now(), this.poller.sources());
    // The evaluate above mutated durable nodes' slots in place; persist them (debounced) so the
    // latest accumulated history is on disk before any restart.
    this.durable?.capture(this.graph.nodes, this.mem);
    this.lastResults = results;
    this.lastRunAt = Date.now();
    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    const generation = this.generation;
    for (const { nodeId, call } of sinkCalls(this.graph.nodes, results)) {
      // Reconciling sinks decide whether to hold by comparing desired values with the current
      // entity snapshot inside the engine. Do not permanently de-dupe those calls: if a previous
      // actuation failed, or HA later drifts back, the same correction must be allowed to fire
      // again. We do suppress an identical call while it is already in flight, and the generic
      // call-service sink keeps its old edge-ish behavior by remembering the last successful
      // command until its desired service/data changes.
      const nodeType = byId.get(nodeId)?.type ?? "";
      const rememberUntilChange = nodeType === "sink-call";
      const key = JSON.stringify(call);
      if (this.inFlight.get(nodeId) === key) continue;
      if (rememberUntilChange && this.lastNonReconciling.get(nodeId) === key) continue;
      this.inFlight.set(nodeId, key);
      if (this.actuate) {
        void this.executeCall(generation, nodeId, key, call, rememberUntilChange);
      } else {
        this.inFlight.delete(nodeId);
        if (rememberUntilChange) this.lastNonReconciling.set(nodeId, key);
        const targetId = call.target?.entity_id ?? "";
        log("info", "deployer", "sink call", { mode: "dry-run", service: call.service, entity: targetId, data: call.data });
      }
    }
  }

  private async executeCall(
    generation: number,
    nodeId: string,
    key: string,
    call: Parameters<HAClient["callService"]>[0],
    rememberUntilChange: boolean,
  ): Promise<void> {
    const targetId = call.target?.entity_id ?? "";
    try {
      await this.ha.callService(call);
      if (generation === this.generation && this.inFlight.get(nodeId) === key && rememberUntilChange) {
        this.lastNonReconciling.set(nodeId, key);
      }
      log("info", "deployer", "sink call", { mode: "live", service: call.service, entity: targetId, data: call.data });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", "deployer", "sink call failed", { mode: "live", service: call.service, entity: targetId, error: msg });
    } finally {
      if (generation === this.generation && this.inFlight.get(nodeId) === key) this.inFlight.delete(nodeId);
    }
  }
}
