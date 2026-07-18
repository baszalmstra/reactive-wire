import type { NodeData } from "../node-types.js";
import type { ValueType } from "../theme.js";
import type { RWValue, Status } from "../value.js";
import { createRecord, ownValue, setOwn } from "../record.js";
export { durationSeconds } from "../duration.js";

/**
 * Per-node internal state for stateful nodes. One map keyed by node id is shared by every
 * stateful node, so each slot carries the union of fields the node kinds need:
 * a boolean state (toggle), an accumulated value (fold/scan), a latched value (hold), and
 * the previous reading used to detect a change between recomputes (edge/rising/falling).
 */
export interface NodeMemory {
  /** Boolean state for toggle; accumulated value for fold/scan. */
  state?: unknown;
  /** Previous boolean reading, for rising-edge detection on a level-true trigger. */
  prev?: boolean;
  /** Last latched value held by a hold node. */
  held?: RWValue | null;
  /** Previous ok input value, for change detection by edge/rising/falling. */
  prevVal?: RWValue | null;
  /** Set once the node's initial state has been established (seeded). */
  seeded?: boolean;
  /** Set once a fold/scan node has folded in at least one value, so min/max can take the first. */
  accumulated?: boolean;
}
export type Memory = Record<string, NodeMemory>;

/** Create node memory without an Object prototype, so every possible key is an own data key. */
export function createMemory(): Memory {
  return createRecord<NodeMemory>();
}

/** Read a node memory slot without falling through to Object.prototype. */
export function memoryValue(memory: Memory, nodeId: string): NodeMemory | undefined {
  return ownValue(memory, nodeId);
}

/** Store a node memory slot without invoking the legacy __proto__ setter. */
export function setMemoryValue(memory: Memory, nodeId: string, value: NodeMemory): NodeMemory {
  setOwn(memory, nodeId, value);
  return value;
}

/** Return this node's slot, creating a prototype-safe own slot when absent. */
export function ensureMemoryValue(memory: Memory, nodeId: string): NodeMemory {
  return memoryValue(memory, nodeId) ?? setMemoryValue(memory, nodeId, {});
}

/**
 * The latest result an async data-source node has fetched, keyed by node id. The fetching
 * itself happens at the edge (a poller outside the engine), which writes the raw response
 * body here and triggers a recompute; the engine only reads the current value, so the core
 * recompute stays synchronous and glitch-free.
 *
 * - status "ok": `body` is the parsed response (decoded JSON, or the raw text otherwise).
 * - status "unavailable": no successful fetch yet (still loading) or the source was cleared.
 * - status "error": the last fetch failed; `msg` carries the reason.
 *
 * A node id absent from this map reads as unavailable, so a freshly deployed graph or an
 * editor preview with no poller shows the source as still loading rather than breaking.
 */
export interface SourceResult {
  status: "ok" | "unavailable" | "error";
  body?: unknown;
  msg?: string;
}
export type SourceMap = Record<string, SourceResult>;

/**
 * Read a dot-separated path (e.g. "main.temp" or "results.0.value") out of a fetched body.
 * An empty path returns the body itself. A missing key or out-of-range index returns
 * undefined, which the caller treats as "value not present".
 */
export function readPath(body: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) return body;
  let cur: unknown = body;
  for (const key of trimmed.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(key);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * How a stateful node's memory is established at boot and treated across restarts.
 * - "seed-at-boot": start from the node's configured initial value; memory is ephemeral and
 *   is rebuilt from config whenever the graph is (re)deployed or the server restarts.
 * - "durable": same boot seed, but the memory is meant to be persisted and restored verbatim
 *   so accumulated history survives a restart. Persisting to disk is the caller's job; the
 *   engine seeds identically and never discards a restored slot.
 * - "reseed-from-world": establish the initial state by reading a live entity's current value
 *   at boot rather than from config, so the node starts aligned with the real world.
 */
export type StatePolicy = "seed-at-boot" | "durable" | "reseed-from-world";

/** A stateful node's declared persistence policy, defaulting to ephemeral boot-seeding. */
export function statePolicy(cfg: Record<string, unknown>): StatePolicy {
  const p = cfg.persistence;
  if (p === "durable" || p === "reseed-from-world") return p;
  return "seed-at-boot";
}

/** Worst-status combine; stale still computes so last-known values keep flowing. */
export function gate(inputs: (RWValue | null)[]): Status {
  if (inputs.some((x) => x && x.status === "error")) return "error";
  if (inputs.some((x) => !x || x.status === "unavailable")) return "unavailable";
  if (inputs.some((x) => x && x.status === "stale")) return "stale";
  return "ok";
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function toNumber(x: unknown, fallback: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Combine a running fold accumulator with the next value for the given operation. For min/max
 * the very first accumulated value is taken as-is rather than combined with the configured
 * initial, so the result isn't pinned by a default seed (e.g. min never stuck at 0).
 */
export function applyFold(op: string, acc: unknown, next: unknown, first: boolean): number {
  const a = toNumber(acc, 0);
  const b = toNumber(next, 0);
  switch (op) {
    case "count": return a + 1;
    case "max": return first ? b : Math.max(a, b);
    case "min": return first ? b : Math.min(a, b);
    case "sum":
    default: return a + b;
  }
}

export function applyCompare(a: unknown, op: string, b: unknown): boolean {
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case "<": return (a as number) < (b as number);
    case ">": return (a as number) > (b as number);
    case "<=": return (a as number) <= (b as number);
    case ">=": return (a as number) >= (b as number);
    default: return false;
  }
}

/**
 * Seconds between two instants given as epoch milliseconds (`a - b`), rounded to one decimal.
 * This is how a datetime difference becomes a Duration, whose magnitude is a number of seconds.
 */
export function instantDiffSeconds(aMs: number, bMs: number): number {
  return round1((aMs - bMs) / 1000);
}

/**
 * Shift an instant (epoch milliseconds) by a span of seconds, returning epoch milliseconds.
 * `dir` is +1 to move forward in time and -1 to move back, so a datetime plus/minus a Duration
 * stays a datetime.
 */
export function shiftInstant(instantMs: number, seconds: number, dir: 1 | -1): number {
  return instantMs + dir * seconds * 1000;
}

/** The value type a configured input-helper sink expects, taken from its target entity's domain. */
export function inputHelperType(n: NodeData): ValueType {
  const domain = String(n.config?.entity_id ?? "").split(".")[0] ?? "";
  switch (domain) {
    case "input_boolean": return "bool";
    case "input_number": return "num";
    case "input_text":
    case "input_select":
    default: return "str";
  }
}
