import { evaluate, isSink, isTransientSink, sinkCalls, type Memory, type ViewEdge } from "../../shared/engine/evaluate.js";
import { createMemory } from "../../shared/engine/engine-support.js";
import { expandMacros } from "../../shared/engine/expand.js";
import type { RuntimeMacroMap } from "../../shared/macros.js";
import type { Health } from "../../shared/node-types.js";
import type { RuntimeNode } from "../../shared/runtime-types.js";
import type { EntityMap } from "../../shared/entities.js";
import type { EvalResults, ServiceCall } from "../../shared/results.js";
import type { RWValue } from "../../shared/value.js";
import { pinKey } from "../../shared/identity.js";
import { type EntityFeed, type HAClient, type HAConnectionStatus } from "../ha/client.js";
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
  /** Whether this sink's serialized channel is awaiting a service response. */
  inFlight: boolean;
  /** Number of deliveries waiting behind the active one. */
  queueDepth: number;
  /** Per-sink sequence currently executing, or null while idle. */
  activeSequence: number | null;
  /** Sequence that will be assigned to the next delivery. */
  nextSequence: number;
  /** Whether the bounded transient queue rejected an event. */
  overflowed: boolean;
  /** The most recent call this sink attempted or dry-ran. */
  lastCall: ServiceCall | null;
  /** Epoch ms when the most recent call was triggered, or null if it has never triggered. */
  lastTriggeredAt: number | null;
  /** For generic call-service sinks, the last command remembered until its desired value changes. */
  lastCommand: string | null;
}

/** A read-only snapshot of the Deployer's runtime state for introspection. */
export interface DeployerSnapshot {
  deployed: boolean;
  generation: number;
  mode: "live" | "dry-run";
  /** Home Assistant transport/snapshot readiness; live mode is paused unless this is ready. */
  haStatus: HAConnectionStatus;
  /** Epoch ms of the last recompute, or null if the graph has never run. */
  evaluatedAt: number | null;
  nodes: Record<string, DebugNode>;
  sinks: Record<string, DebugSink>;
}

interface SinkFailure {
  /** The desired call + observed-world context that failed. */
  key: string;
  message: string;
}

type SinkMode = "reconciling" | "command" | "transient";

interface Delivery {
  generation: number;
  connectionEpoch: number;
  sequence: number;
  key: string;
  failureKey: string;
  call: ServiceCall;
}

interface SinkChannel {
  nodeId: string;
  mode: SinkMode;
  active: Delivery | null;
  /** Reconciling/command sinks keep only the most recent desired work while active. */
  pendingLatest: Delivery | null;
  /** Transient sinks preserve transaction order in a bounded FIFO. */
  queue: Delivery[];
  nextSequence: number;
  overflowed: boolean;
}

const MAX_TRANSIENT_QUEUE = 100;

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

function keyOf(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Fall through to String for circular or otherwise unserializable values.
  }
  return String(value);
}

function serviceErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    return keyOf(err);
  }
  return String(err);
}

function isReconcilingSinkType(type: string): boolean {
  return type !== "sink-call" && !isTransientSink(type);
}

/** The target entity state the current correction was based on, folded into de-dupe keys. */
function observedTargetState(call: ServiceCall, entities: EntityMap): unknown {
  const entityId = call.target?.entity_id;
  if (!entityId) return null;
  return entities[entityId] ?? null;
}

function reconcilingAttemptKey(call: ServiceCall, entities: EntityMap): string {
  return keyOf({ call, observed: observedTargetState(call, entities) });
}

/** A no-op fetch used when no real one is supplied; every fetch source then stays unavailable. */
const noFetch: FetchFn = () => Promise.reject(new Error("no fetch configured"));

/**
 * Persistence for the memory slots of nodes declaring the "durable" state policy: restored into a
 * fresh memory on deploy and captured after each tick, so accumulated history survives a restart.
 */
export interface DurableMemory {
  /** Seed durable slots into a freshly cleared memory for the given graph. */
  restore(nodes: RuntimeNode[], mem: Memory): void;
  /** Record the current durable slots after a recompute. */
  capture(nodes: RuntimeNode[], mem: Memory): void;
  /** Flush any pending write and release resources. */
  stop(): void;
}

/**
 * Runs a deployed graph with the same engine the editor previews with: on every entity
 * change it re-evaluates and reconciles each sink. A reconciling sink gets one service attempt
 * for a given desired call + observed target state, then waits for the target or desired value to
 * change before trying that same correction again. Sinks whose command input is not a concrete
 * value are skipped, so an offline input can never actuate. In preview mode calls are logged
 * instead of executed.
 *
 * Async data-source (fetch) nodes are driven by a Poller at the edge: it fetches each source
 * on its interval and writes the latest body into a source map, then triggers a recompute. The
 * core recompute itself stays synchronous and simply reads those last values.
 */
export class Deployer {
  private graph: { nodes: RuntimeNode[]; edges: ViewEdge[] } | null = null;
  private mem: Memory = createMemory();
  private actuate = false;
  private generation = 0;
  private readonly channels = new Map<string, SinkChannel>();
  private readonly lastNonReconciling = new Map<string, string>();
  private readonly lastReconcilingAttempt = new Map<string, string>();
  private readonly callFailures = new Map<string, SinkFailure>();
  private readonly lastTriggeredAt = new Map<string, number>();
  private readonly lastTriggeredCall = new Map<string, ServiceCall>();
  private tick: ReturnType<typeof setInterval> | null;
  private readonly poller: Poller;
  private readonly unsubscribeEntities: () => void;
  private readonly unsubscribeConnection: () => void;
  private stopped = false;
  private lastResults: EvalResults | null = null;
  private lastRunAt: number | null = null;

  constructor(
    private readonly ha: HAClient & EntityFeed,
    tickMs = 1000,
    fetchFn: FetchFn = noFetch,
    private readonly durable?: DurableMemory,
  ) {
    this.unsubscribeEntities = ha.onEntities(() => this.run());
    this.unsubscribeConnection = ha.onConnection((status) => this.connectionChanged(status));
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
  deploy(nodes: RuntimeNode[], edges: ViewEdge[], actuate: boolean, macros: RuntimeMacroMap = {}): void {
    if (this.stopped) throw new Error("Deployer has been stopped");
    const flat = expandMacros(nodes, edges, macros, undefined, true);
    this.generation += 1;
    this.channels.clear();
    this.lastNonReconciling.clear();
    this.lastReconcilingAttempt.clear();
    this.callFailures.clear();
    this.lastTriggeredAt.clear();
    this.lastTriggeredCall.clear();
    this.graph = { nodes: flat.nodes, edges: flat.edges };
    this.actuate = actuate;
    this.mem = createMemory();
    // Durable slots are restored before the first run so an accumulated fold/scan resumes from its
    // persisted history rather than reseeding; stale slots for departed nodes are dropped here.
    this.durable?.restore(flat.nodes, this.mem);
    this.poller.start(flat.nodes);
    this.run();
  }

  /**
   * Permanently deactivate this runtime. An already accepted HA service call cannot be recalled,
   * but its eventual completion belongs to the invalidated generation and cannot update state.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.actuate = false;
    this.graph = null;
    this.generation += 1;
    this.unsubscribeEntities();
    this.unsubscribeConnection();
    if (this.tick !== null) {
      clearInterval(this.tick);
      this.tick = null;
    }
    this.poller.stop();
    this.channels.clear();
    this.lastNonReconciling.clear();
    this.lastReconcilingAttempt.clear();
    this.callFailures.clear();
    this.lastTriggeredAt.clear();
    this.lastTriggeredCall.clear();
    this.lastResults = null;
    this.lastRunAt = null;
    this.mem = createMemory();
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
          const v = results.outputs[pinKey(n.id, p.id)];
          if (v) outputs[p.id] = debugValue(v);
        }
        const failure = isSink(n.type) ? this.callFailures.get(n.id) : undefined;
        nodes[n.id] = { type: n.type, health: failure ? "error" : results.health[n.id] ?? "ok", outputs };
        if (isSink(n.type)) {
          const action = results.actions[n.id];
          const desired = results.sinks[n.id];
          const lastCall = this.lastTriggeredCall.get(n.id) ?? null;
          const channel = this.channels.get(n.id);
          const queueDepth = channel ? channel.queue.length + (channel.pendingLatest ? 1 : 0) : 0;
          sinks[n.id] = {
            desired: desired ? debugCall(desired) : null,
            note: failure ? `last call failed: ${failure.message}` : channel?.overflowed ? "transient queue overflowed; newest event rejected" : action?.note,
            status: failure || channel?.overflowed ? "error" : action?.status ?? "ok",
            inFlight: !!channel?.active,
            queueDepth,
            activeSequence: channel?.active?.sequence ?? null,
            nextSequence: channel?.nextSequence ?? 1,
            overflowed: channel?.overflowed ?? false,
            lastCall: lastCall ? debugCall(lastCall) : null,
            lastTriggeredAt: this.lastTriggeredAt.get(n.id) ?? null,
            lastCommand: this.lastNonReconciling.get(n.id) ?? null,
          };
        }
      }
    }
    return {
      deployed: graph !== null,
      generation: this.generation,
      mode: this.actuate ? "live" : "dry-run",
      haStatus: this.ha.connectionStatus(),
      evaluatedAt: this.lastRunAt,
      nodes,
      sinks,
    };
  }

  private recordTriggered(nodeId: string, call: ServiceCall): void {
    this.lastTriggeredAt.set(nodeId, Date.now());
    this.lastTriggeredCall.set(nodeId, call);
  }

  private connectionChanged(status: HAConnectionStatus): void {
    if (this.stopped) return;
    // An accepted service call cannot be recalled. Keep it active until its promise settles so a
    // reconnect can never start overlapping work for the same sink.
    this.lastReconcilingAttempt.clear();
    if (status.phase === "ready") {
      this.run();
      for (const channel of this.channels.values()) this.pumpChannel(channel);
    }
  }

  private run(): void {
    if (this.stopped || !this.graph || this.ha.connectionStatus().phase !== "ready") return;
    const entities: EntityMap = this.ha.entitiesSnapshot().entities as EntityMap;
    const results = evaluate(this.graph.nodes, this.graph.edges, entities, this.mem, Date.now(), this.poller.sources());
    this.durable?.capture(this.graph.nodes, this.mem);
    this.lastResults = results;
    this.lastRunAt = Date.now();
    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    for (const n of this.graph.nodes) {
      if (!isSink(n.type) || !isReconcilingSinkType(n.type) || results.sinks[n.id]) continue;
      this.lastReconcilingAttempt.delete(n.id);
      this.callFailures.delete(n.id);
      const channel = this.channels.get(n.id);
      if (channel) channel.pendingLatest = null;
    }
    for (const { nodeId, call } of sinkCalls(this.graph.nodes, results)) {
      const nodeType = byId.get(nodeId)?.type ?? "";
      const mode: SinkMode = isTransientSink(nodeType) ? "transient" : nodeType === "sink-call" ? "command" : "reconciling";
      const key = keyOf(call);
      const failureKey = mode === "reconciling" ? reconcilingAttemptKey(call, entities) : key;
      if (this.callFailures.get(nodeId)?.key !== failureKey) this.callFailures.delete(nodeId);
      this.enqueueDelivery(nodeId, mode, key, failureKey, call);
    }
  }

  private channelFor(nodeId: string, mode: SinkMode): SinkChannel {
    let channel = this.channels.get(nodeId);
    if (!channel) {
      channel = { nodeId, mode, active: null, pendingLatest: null, queue: [], nextSequence: 1, overflowed: false };
      this.channels.set(nodeId, channel);
    }
    return channel;
  }

  private enqueueDelivery(nodeId: string, mode: SinkMode, key: string, failureKey: string, call: ServiceCall): void {
    const channel = this.channelFor(nodeId, mode);
    if (mode === "command" && this.lastNonReconciling.get(nodeId) === key) return;
    if (mode === "reconciling" && this.lastReconcilingAttempt.get(nodeId) === failureKey
      && channel.active?.failureKey !== failureKey && channel.pendingLatest?.failureKey !== failureKey) return;
    const status = this.ha.connectionStatus();
    const delivery: Delivery = {
      generation: this.generation,
      connectionEpoch: status.epoch,
      sequence: channel.nextSequence++,
      key,
      failureKey,
      call,
    };
    if (mode === "transient") {
      if (channel.active) {
        if (channel.queue.length >= MAX_TRANSIENT_QUEUE) {
          channel.overflowed = true;
          this.callFailures.set(nodeId, { key, message: `transient queue limit ${MAX_TRANSIENT_QUEUE} reached; newest event rejected` });
          return;
        }
        channel.queue.push(delivery);
      } else {
        channel.queue.push(delivery);
      }
    } else if (channel.active) {
      channel.pendingLatest = channel.active.key === key ? null : delivery;
    } else {
      channel.pendingLatest = delivery;
    }
    this.pumpChannel(channel);
  }

  private pumpChannel(channel: SinkChannel): void {
    if (this.stopped || channel.active || channel.nodeId !== this.channels.get(channel.nodeId)?.nodeId) return;
    if (this.ha.connectionStatus().phase !== "ready") return;
    const delivery = channel.mode === "transient" ? channel.queue.shift() ?? null : channel.pendingLatest;
    if (!delivery) return;
    if (channel.mode !== "transient") channel.pendingLatest = null;
    if (delivery.generation !== this.generation) return;
    delivery.connectionEpoch = this.ha.connectionStatus().epoch;
    channel.active = delivery;
    if (channel.mode === "reconciling") this.lastReconcilingAttempt.set(channel.nodeId, delivery.failureKey);
    this.callFailures.delete(channel.nodeId);
    this.recordTriggered(channel.nodeId, delivery.call);
    if (!this.actuate) {
      this.completeDryRun(channel, delivery);
      return;
    }
    void this.executeDelivery(channel, delivery);
  }

  private completeDryRun(channel: SinkChannel, delivery: Delivery): void {
    if (channel.mode === "command") this.lastNonReconciling.set(channel.nodeId, delivery.key);
    const targetId = delivery.call.target?.entity_id ?? "";
    log("info", "deployer", "sink call", { mode: "dry-run", service: delivery.call.service, entity: targetId, data: delivery.call.data });
    channel.active = null;
    this.pumpChannel(channel);
  }

  private async executeDelivery(channel: SinkChannel, delivery: Delivery): Promise<void> {
    const targetId = delivery.call.target?.entity_id ?? "";
    const isCurrent = () => delivery.generation === this.generation
      && this.channels.get(channel.nodeId) === channel
      && channel.active === delivery;
    const readyForEpoch = () => {
      const status = this.ha.connectionStatus();
      return status.phase === "ready" && status.epoch === delivery.connectionEpoch;
    };
    let acknowledged = false;
    try {
      if (!isCurrent() || !readyForEpoch()) return;
      const response = this.ha.callService(delivery.call);
      if (response && typeof response.then === "function") await response;
      acknowledged = true;
      if (isCurrent() && readyForEpoch()) {
        if (channel.mode === "command") this.lastNonReconciling.set(channel.nodeId, delivery.key);
        this.callFailures.delete(channel.nodeId);
      }
      log("info", "deployer", "sink call", { mode: "live", service: delivery.call.service, entity: targetId, data: delivery.call.data });
    } catch (err) {
      const msg = serviceErrorMessage(err);
      if (isCurrent() && readyForEpoch()) this.callFailures.set(channel.nodeId, { key: delivery.failureKey, message: msg });
      log("error", "deployer", "sink call failed", { mode: "live", service: delivery.call.service, entity: targetId, error: msg });
    } finally {
      if (!isCurrent()) return;
      channel.active = null;
      if (acknowledged && channel.pendingLatest?.key === delivery.key) channel.pendingLatest = null;
      this.pumpChannel(channel);
    }
  }
}
