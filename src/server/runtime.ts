import { evaluate, sinkCalls, type Memory, type ViewEdge } from "../../shared/engine/evaluate.js";
import { expandMacros } from "../../shared/engine/expand.js";
import type { MacroMap } from "../../shared/macros.js";
import type { NodeData } from "../../shared/node-types.js";
import type { EntityMap } from "../../shared/entities.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { Poller, type FetchFn } from "./poller.js";

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

  private run(): void {
    if (!this.graph) return;
    const entities: EntityMap = this.ha.entitiesSnapshot();
    const results = evaluate(this.graph.nodes, this.graph.edges, entities, this.mem, Date.now(), this.poller.sources());
    // The evaluate above mutated durable nodes' slots in place; persist them (debounced) so the
    // latest accumulated history is on disk before any restart.
    this.durable?.capture(this.graph.nodes, this.mem);
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
        console.log(`[dry-run] ${call.service} ${targetId} ${JSON.stringify(call.data)}`);
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
      console.log(`[live] ${call.service} ${targetId} ${JSON.stringify(call.data)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[live:error] ${call.service} ${targetId} ${msg}`);
    } finally {
      if (generation === this.generation && this.inFlight.get(nodeId) === key) this.inFlight.delete(nodeId);
    }
  }
}
