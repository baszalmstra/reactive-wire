import { evaluateIncremental, isSink, isTransientSink, sinkCalls, type Memory, type ViewEdge } from "../../shared/engine/evaluate.js";
import { compileGraph, type CompiledGraph } from "../../shared/engine/compile.js";
import { createMemory, memoryValue, setMemoryValue } from "../../shared/engine/engine-support.js";
import type { RuntimeMacroMap } from "../../shared/macros.js";
import type { Health } from "../../shared/node-types.js";
import type { RuntimeNode } from "../../shared/runtime-types.js";
import type { EntityMap } from "../../shared/entities.js";
import type { EvalResults, ServiceCall } from "../../shared/results.js";
import type { RWValue } from "../../shared/value.js";
import { pinKey } from "../../shared/identity.js";
import { type EntityFeed, type EntityUpdate, type HAClient, type HAConnectionStatus } from "../ha/client.js";
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
  /** Latest proposal observed by the runtime. */
  observedKey: string | null;
  /** Latest proposal accepted into delivery state. */
  enqueuedKey: string | null;
  /** Latest proposal passed to Home Assistant. */
  attemptedKey: string | null;
  /** Latest proposal whose call resolved successfully. */
  acknowledgedKey: string | null;
  /** Consecutive delivery failures. */
  failures: number;
  /** Epoch ms of the independently scheduled retry, or null. */
  nextRetryAt: number | null;
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
  /** Number of non-empty evaluation transactions in this deployment generation. */
  transactionCount: number;
  /** Cause of the last non-empty transaction. */
  lastCause: EvaluationCause["kind"] | null;
  /** Nodes actually evaluated in the last transaction (operation-count evidence). */
  lastEvaluatedNodeCount: number;
  nodes: Record<string, DebugNode>;
  sinks: Record<string, DebugSink>;
}

export type EvaluationCause =
  | { kind: "deploy" | "ha-full" | "ha-ready" }
  | { kind: "entities"; entityIds: readonly string[] }
  | { kind: "fetch"; nodeId: string }
  | { kind: "clock" }
  | { kind: "sink-retry"; nodeId: string };

interface SinkFailure {
  /** The desired call + observed-world context that failed. */
  key: string;
  message: string;
}

type SinkMode = "reconciling" | "command" | "transient";

interface Delivery {
  generation: number;
  connectionEpoch: number;
  mode: SinkMode;
  sequence: number;
  key: string;
  failureKey: string;
  call: ServiceCall;
  attempts: number;
  /** For transient sinks, the value whose successful delivery advances the acknowledged baseline. */
  transientValue?: RWValue;
}

interface SinkChannel {
  nodeId: string;
  mode: SinkMode;
  /** Removed sinks retain their physical lane only until an accepted call settles. */
  retired: boolean;
  active: Delivery | null;
  /** Reconciling/command sinks keep only the most recent desired work while active. */
  pendingLatest: Delivery | null;
  /** Transient sinks preserve transaction order in a bounded FIFO. */
  queue: Delivery[];
  nextSequence: number;
  overflowed: boolean;
  observedKey: string | null;
  enqueuedKey: string | null;
  attemptedKey: string | null;
  acknowledgedKey: string | null;
  failures: number;
  retryDelivery: Delivery | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  nextRetryAt: number | null;
}

const MAX_TRANSIENT_QUEUE = 100;
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

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
  private graph: CompiledGraph | null = null;
  private mem: Memory = createMemory();
  private actuate = false;
  private generation = 0;
  private readonly channels = new Map<string, SinkChannel>();
  private readonly lastNonReconciling = new Map<string, string>();
  private readonly lastReconcilingAttempt = new Map<string, string>();
  private readonly callFailures = new Map<string, SinkFailure>();
  private readonly lastTriggeredAt = new Map<string, number>();
  private readonly lastTriggeredCall = new Map<string, ServiceCall>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private readonly poller: Poller;
  private readonly unsubscribeEntities: () => void;
  private readonly unsubscribeConnection: () => void;
  private stopped = false;
  private lastResults: EvalResults | null = null;
  private lastRunAt: number | null = null;
  private transactionCount = 0;
  private lastCause: EvaluationCause["kind"] | null = null;
  private lastEvaluatedNodeCount = 0;

  constructor(
    private readonly ha: HAClient & EntityFeed,
    private readonly tickMs = 1000,
    fetchFn: FetchFn = noFetch,
    private readonly durable?: DurableMemory,
  ) {
    this.unsubscribeEntities = ha.onEntities((update) => this.entitiesChanged(update));
    this.unsubscribeConnection = ha.onConnection((status) => this.connectionChanged(status));
    this.poller = new Poller(fetchFn, (nodeId) => this.run({ kind: "fetch", nodeId }));
  }

  /**
   * Deploy a graph. Macro placements are inlined into a flat subgraph first (the same expansion
   * the editor preview uses), so the single engine runs over plain nodes and every sink — including
   * those inside macros — is reconciled, with each placement's state kept separate by its namespaced
   * ids. When `actuate` is true sinks call services; otherwise they dry-run.
   */
  deploy(nodes: RuntimeNode[], edges: ViewEdge[], actuate: boolean, macros: RuntimeMacroMap = {}): void {
    if (this.stopped) throw new Error("Deployer has been stopped");
    const compiled = compileGraph(nodes, edges, macros);
    this.generation += 1;
    this.prepareChannelsForDeploy(compiled);
    this.lastNonReconciling.clear();
    this.lastReconcilingAttempt.clear();
    this.callFailures.clear();
    this.lastTriggeredAt.clear();
    this.lastTriggeredCall.clear();
    this.graph = compiled;
    this.actuate = actuate;
    this.mem = createMemory();
    // Durable slots are restored before the first run so an accumulated fold/scan resumes from its
    // persisted history rather than reseeding; stale slots for departed nodes are dropped here.
    this.durable?.restore(compiled.durableNodes, this.mem);
    this.poller.start(compiled.nodes);
    if (this.tick !== null) clearInterval(this.tick);
    this.tick = compiled.clockRoots.size > 0
      ? setInterval(() => this.run({ kind: "clock" }), this.tickMs)
      : null;
    this.transactionCount = 0;
    this.lastCause = null;
    this.lastEvaluatedNodeCount = 0;
    this.lastResults = null;
    this.run({ kind: "deploy" });
    for (const channel of this.channels.values()) {
      if (channel.retryDelivery && !channel.retryTimer) this.scheduleRetry(channel, 0);
      this.pumpChannel(channel);
    }
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
    this.resetChannels();
    this.lastNonReconciling.clear();
    this.lastReconcilingAttempt.clear();
    this.callFailures.clear();
    this.lastTriggeredAt.clear();
    this.lastTriggeredCall.clear();
    this.lastResults = null;
    this.lastRunAt = null;
    this.transactionCount = 0;
    this.lastCause = null;
    this.lastEvaluatedNodeCount = 0;
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
            observedKey: channel?.observedKey ?? null,
            enqueuedKey: channel?.enqueuedKey ?? null,
            attemptedKey: channel?.attemptedKey ?? null,
            acknowledgedKey: channel?.acknowledgedKey ?? null,
            failures: channel?.failures ?? 0,
            nextRetryAt: channel?.nextRetryAt ?? null,
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
      transactionCount: this.transactionCount,
      lastCause: this.lastCause,
      lastEvaluatedNodeCount: this.lastEvaluatedNodeCount,
      nodes,
      sinks,
    };
  }

  private resetChannels(): void {
    for (const channel of this.channels.values()) {
      if (channel.retryTimer) clearTimeout(channel.retryTimer);
    }
    this.channels.clear();
  }

  /**
   * Preserve the physical lane for an accepted service call across graph generations. An unchanged
   * transient sink also keeps its accepted FIFO; removed/changed sinks finish only the call already
   * handed to HA and discard work that had not started.
   */
  private prepareChannelsForDeploy(graph: CompiledGraph): void {
    const nextModes = new Map<string, SinkMode>();
    for (const nodeId of graph.sinkIds) {
      const type = graph.nodeById.get(nodeId)?.type ?? "";
      nextModes.set(nodeId, isTransientSink(type) ? "transient" : type === "sink-call" ? "command" : "reconciling");
    }
    for (const [nodeId, channel] of this.channels) {
      const nextMode = nextModes.get(nodeId);
      const unchangedTransient = channel.mode === "transient" && nextMode === "transient";
      if (channel.retryTimer) clearTimeout(channel.retryTimer);
      channel.retryTimer = null;
      channel.nextRetryAt = null;
      if (!unchangedTransient) {
        channel.queue = [];
        channel.pendingLatest = null;
        channel.retryDelivery = null;
      }
      if (!nextMode) {
        channel.retired = true;
        if (!channel.active) this.channels.delete(nodeId);
        continue;
      }
      channel.retired = false;
      channel.mode = nextMode;
      // Accepted transient entries are generation-independent physical work once enqueued.
      if (unchangedTransient) {
        for (const delivery of channel.queue) delivery.generation = this.generation;
        if (channel.retryDelivery) channel.retryDelivery.generation = this.generation;
      }
    }
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
      this.run({ kind: "ha-ready" });
      for (const channel of this.channels.values()) {
        if (channel.retryDelivery && !channel.retryTimer) this.scheduleRetry(channel, 0);
        this.pumpChannel(channel);
      }
    }
  }

  private entitiesChanged(update: EntityUpdate): void {
    if (update.kind === "full") {
      this.run({ kind: "ha-full" });
      return;
    }
    this.run({ kind: "entities", entityIds: [...Object.keys(update.changed), ...update.removed] });
  }

  private dirtyRoots(cause: EvaluationCause): Iterable<string> | null {
    if (!this.graph || cause.kind === "deploy" || cause.kind === "ha-full" || cause.kind === "ha-ready") return null;
    if (cause.kind === "clock") return this.graph.clockRoots;
    if (cause.kind === "fetch" || cause.kind === "sink-retry") return [cause.nodeId];
    if (cause.kind !== "entities") return [];
    const roots = new Set<string>();
    for (const entityId of cause.entityIds) {
      for (const nodeId of this.graph.entityRoots.get(entityId) ?? []) roots.add(nodeId);
    }
    return roots;
  }

  private run(cause: EvaluationCause): void {
    if (this.stopped || !this.graph || this.ha.connectionStatus().phase !== "ready") return;
    const roots = this.dirtyRoots(cause);
    const entities: EntityMap = this.ha.entitiesSnapshot().entities as EntityMap;
    const transactionNow = Date.now();
    const transaction = evaluateIncremental(
      this.graph,
      this.lastResults,
      roots,
      entities,
      this.mem,
      transactionNow,
      this.poller.sources(),
    );
    if (transaction.evaluatedNodeIds.length === 0) return;
    this.durable?.capture(this.graph.durableNodes, this.mem);
    const results = transaction.results;
    this.lastResults = results;
    this.lastRunAt = transactionNow;
    this.transactionCount += 1;
    this.lastCause = cause.kind;
    this.lastEvaluatedNodeCount = transaction.evaluatedNodeIds.length;
    const evaluated = new Set(transaction.evaluatedNodeIds);
    const evaluatedNodes = this.graph.nodes.filter((node) => evaluated.has(node.id));

    for (const n of evaluatedNodes) {
      if (!isSink(n.type) || isTransientSink(n.type) || results.sinks[n.id]) continue;
      if (isReconcilingSinkType(n.type)) this.lastReconcilingAttempt.delete(n.id);
      this.callFailures.delete(n.id);
      const channel = this.channels.get(n.id);
      if (channel) {
        channel.pendingLatest = null;
        this.cancelRetry(channel);
      }
    }
    for (const { nodeId, call } of sinkCalls(evaluatedNodes, results)) {
      const nodeType = this.graph.nodeById.get(nodeId)?.type ?? "";
      const mode: SinkMode = isTransientSink(nodeType) ? "transient" : nodeType === "sink-call" ? "command" : "reconciling";
      const key = keyOf(call);
      const failureKey = mode === "reconciling" ? reconcilingAttemptKey(call, entities) : key;
      if (this.callFailures.get(nodeId)?.key !== failureKey) this.callFailures.delete(nodeId);
      const transientValue = mode === "transient" ? results.inputs[pinKey(nodeId, "message")] ?? undefined : undefined;
      this.enqueueDelivery(nodeId, mode, key, failureKey, call, transientValue && transientValue.status === "ok" ? transientValue : undefined);
    }
  }

  private channelFor(nodeId: string, mode: SinkMode): SinkChannel {
    let channel = this.channels.get(nodeId);
    if (!channel) {
      channel = {
        nodeId, mode, retired: false, active: null, pendingLatest: null, queue: [], nextSequence: 1,
        overflowed: false, observedKey: null, enqueuedKey: null, attemptedKey: null,
        acknowledgedKey: null, failures: 0, retryDelivery: null, retryTimer: null, nextRetryAt: null,
      };
      this.channels.set(nodeId, channel);
    }
    return channel;
  }

  private enqueueDelivery(
    nodeId: string,
    mode: SinkMode,
    key: string,
    failureKey: string,
    call: ServiceCall,
    transientValue?: RWValue,
  ): void {
    const channel = this.channelFor(nodeId, mode);
    channel.observedKey = key;
    if (channel.retryDelivery) {
      if (channel.retryDelivery.failureKey === failureKey) return;
      this.cancelRetry(channel);
    }
    if (mode === "command" && this.lastNonReconciling.get(nodeId) === key) return;
    if (mode === "reconciling" && this.lastReconcilingAttempt.get(nodeId) === failureKey
      && channel.active?.failureKey !== failureKey && channel.pendingLatest?.failureKey !== failureKey) return;
    const lastTransient = channel.queue[channel.queue.length - 1] ?? channel.active;
    if (mode === "transient" && lastTransient?.key === key) return;
    const status = this.ha.connectionStatus();
    const delivery: Delivery = {
      generation: this.generation,
      connectionEpoch: status.epoch,
      mode,
      sequence: channel.nextSequence++,
      key,
      failureKey,
      call,
      attempts: 0,
      ...(transientValue ? { transientValue } : {}),
    };
    channel.enqueuedKey = key;
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
    if (this.stopped || channel.retired || channel.active || channel.retryDelivery || this.channels.get(channel.nodeId) !== channel) return;
    if (this.ha.connectionStatus().phase !== "ready") return;
    const delivery = channel.mode === "transient" ? channel.queue.shift() ?? null : channel.pendingLatest;
    if (!delivery) return;
    if (channel.mode !== "transient") channel.pendingLatest = null;
    delivery.connectionEpoch = this.ha.connectionStatus().epoch;
    channel.active = delivery;
    delivery.attempts += 1;
    channel.attemptedKey = delivery.key;
    if (delivery.mode === "reconciling") this.lastReconcilingAttempt.set(channel.nodeId, delivery.failureKey);
    this.callFailures.delete(channel.nodeId);
    this.recordTriggered(channel.nodeId, delivery.call);
    if (!this.actuate) {
      this.completeDryRun(channel, delivery);
      return;
    }
    void this.executeDelivery(channel, delivery);
  }

  private completeDryRun(channel: SinkChannel, delivery: Delivery): void {
    this.acknowledgeDelivery(channel, delivery);
    const targetId = delivery.call.target?.entity_id ?? "";
    log("info", "deployer", "sink call", { mode: "dry-run", service: delivery.call.service, entity: targetId, data: delivery.call.data });
    channel.active = null;
    this.pumpChannel(channel);
  }

  private acknowledgeDelivery(channel: SinkChannel, delivery: Delivery): void {
    channel.acknowledgedKey = delivery.key;
    channel.failures = 0;
    this.callFailures.delete(channel.nodeId);
    if (delivery.mode === "command") this.lastNonReconciling.set(channel.nodeId, delivery.key);
    if (delivery.mode === "transient" && delivery.transientValue) {
      const previous = memoryValue(this.mem, channel.nodeId) ?? {};
      setMemoryValue(this.mem, channel.nodeId, { ...previous, prevVal: delivery.transientValue, seeded: true });
    }
  }

  private cancelRetry(channel: SinkChannel): void {
    if (channel.retryTimer) clearTimeout(channel.retryTimer);
    channel.retryTimer = null;
    channel.nextRetryAt = null;
    channel.retryDelivery = null;
  }

  private scheduleRetry(channel: SinkChannel, delay?: number): void {
    const delivery = channel.retryDelivery;
    if (!delivery || channel.retryTimer || channel.retired) return;
    const wait = delay ?? Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.max(0, channel.failures - 1)));
    channel.nextRetryAt = Date.now() + wait;
    channel.retryTimer = setTimeout(() => {
      channel.retryTimer = null;
      channel.nextRetryAt = null;
      if (this.stopped || channel.retired || this.channels.get(channel.nodeId) !== channel) return;
      if (this.ha.connectionStatus().phase !== "ready") return;
      // Re-evaluation may cancel a stale command/correction or replace it with newer desired work.
      if (delivery.mode !== "transient") this.run({ kind: "sink-retry", nodeId: channel.nodeId });
      if (channel.retryDelivery !== delivery) return;
      channel.retryDelivery = null;
      delivery.connectionEpoch = this.ha.connectionStatus().epoch;
      if (delivery.mode === "transient") channel.queue.unshift(delivery);
      else channel.pendingLatest = delivery;
      this.pumpChannel(channel);
    }, wait);
  }

  private async executeDelivery(channel: SinkChannel, delivery: Delivery): Promise<void> {
    const targetId = delivery.call.target?.entity_id ?? "";
    // Generation changes replace logical graph state, not the physical HA call already accepted by
    // this lane. The lane remains authoritative until that promise settles.
    const isCurrent = () => this.channels.get(channel.nodeId) === channel && channel.active === delivery;
    const readyForEpoch = () => {
      const status = this.ha.connectionStatus();
      return status.phase === "ready" && status.epoch === delivery.connectionEpoch;
    };
    let acknowledged = false;
    try {
      if (!isCurrent() || !readyForEpoch()) return;
      const response = this.ha.callService(delivery.call);
      if (response && typeof response.then === "function") await response;
      if (isCurrent() && readyForEpoch()) {
        acknowledged = true;
        this.acknowledgeDelivery(channel, delivery);
      } else if (isCurrent()) {
        channel.failures += 1;
        channel.retryDelivery = delivery;
        this.callFailures.set(channel.nodeId, { key: delivery.failureKey, message: "connection epoch changed before acknowledgement" });
      }
      log("info", "deployer", "sink call", { mode: "live", service: delivery.call.service, entity: targetId, data: delivery.call.data });
    } catch (err) {
      const msg = serviceErrorMessage(err);
      if (isCurrent()) {
        channel.failures += 1;
        channel.retryDelivery = delivery;
        this.callFailures.set(channel.nodeId, { key: delivery.failureKey, message: msg });
      }
      log("error", "deployer", "sink call failed", { mode: "live", service: delivery.call.service, entity: targetId, error: msg });
    } finally {
      if (!isCurrent()) return;
      if (!acknowledged && !channel.retryDelivery) {
        channel.failures += 1;
        channel.retryDelivery = delivery;
        this.callFailures.set(channel.nodeId, { key: delivery.failureKey, message: "delivery paused before acknowledgement" });
      }
      channel.active = null;
      if (acknowledged && channel.pendingLatest?.key === delivery.key) channel.pendingLatest = null;
      if (channel.retired) {
        this.cancelRetry(channel);
        this.channels.delete(channel.nodeId);
      } else if (channel.retryDelivery === delivery) this.scheduleRetry(channel);
      else this.pumpChannel(channel);
    }
  }
}
