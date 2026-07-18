import type { NodeData } from "../../shared/node-types.js";
import type { SourceMap, SourceResult } from "../../shared/engine/evaluate.js";
import { createRecord } from "../../shared/record.js";

/** A minimal HTTP fetch the poller depends on, so tests can inject a mock with no network. */
export type FetchFn = (
  url: string,
  options: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** How an async source node is configured: where to fetch and how often. */
interface FetchConfig {
  url: string;
  intervalMs: number;
}

interface PollState extends FetchConfig {
  nodeId: string;
  generation: number;
  failures: number;
  timer: ReturnType<typeof setTimeout> | null;
  controller: AbortController | null;
  inFlight: boolean;
}

const MIN_INTERVAL_MS = 1_000;
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_RETRY_DELAY_MS = 5 * 60_000;

function fetchConfig(n: NodeData): FetchConfig | null {
  const url = String(n.config?.url ?? "").trim();
  if (!url) return null;
  const seconds = Number(n.config?.interval);
  const intervalMs = Number.isFinite(seconds) && seconds > 0 ? Math.max(MIN_INTERVAL_MS, seconds * 1000) : 60_000;
  return { url, intervalMs };
}

/** Decode a response body as JSON, falling back to the raw text when it isn't JSON. */
function decodeBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function retryDelay(intervalMs: number, failures: number): number {
  // Cap the exponent before multiplying as well as the final delay, avoiding numeric overflow
  // after a long outage. An explicitly slower normal interval remains the minimum cadence.
  const cap = Math.max(intervalMs, MAX_RETRY_DELAY_MS);
  return Math.min(intervalMs * (2 ** Math.min(failures, 20)), cap);
}

/**
 * Drives async data-source nodes at the server edge. Each source owns one completion-scheduled
 * request loop: a new request is never started until the previous request (including body decode)
 * has settled. Requests have a timeout and failures back off independently. Stop/redeploy aborts
 * active work and advances a generation so a late response cannot publish or schedule more work.
 */
export class Poller {
  private readonly states = new Map<string, PollState>();
  private readonly results = createRecord<SourceResult>();
  private generation = 0;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly onUpdate: () => void,
  ) {}

  /** The latest fetched result per source node, for handing to evaluate(). */
  sources(): SourceMap {
    return this.results;
  }

  /** Replace the current schedule and immediately fetch each configured source once. */
  start(nodes: NodeData[]): void {
    this.stop();
    const generation = this.generation;
    for (const n of nodes) {
      if (n.type !== "fetch") continue;
      const cfg = fetchConfig(n);
      this.results[n.id] = { status: "unavailable" };
      if (!cfg) continue;
      const state: PollState = {
        ...cfg,
        nodeId: n.id,
        generation,
        failures: 0,
        timer: null,
        controller: null,
        inFlight: false,
      };
      this.states.set(n.id, state);
      void this.poll(state);
    }
  }

  /** Stop timers, abort active requests, invalidate late completions, and forget source results. */
  stop(): void {
    this.generation += 1;
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      state.controller?.abort();
      state.controller = null;
    }
    this.states.clear();
    for (const key of Object.keys(this.results)) delete this.results[key];
  }

  private isCurrent(state: PollState): boolean {
    return state.generation === this.generation && this.states.get(state.nodeId) === state;
  }

  private schedule(state: PollState, delayMs: number): void {
    if (!this.isCurrent(state)) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.poll(state);
    }, delayMs);
  }

  private async poll(state: PollState): Promise<void> {
    // This also protects the single-flight invariant if a callback is ever invoked twice. If an
    // injected fetch ignores AbortSignal forever, this source remains parked here rather than
    // accumulating more unresolved requests.
    if (!this.isCurrent(state) || state.inFlight) return;
    state.inFlight = true;
    const controller = new AbortController();
    state.controller = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    let next: SourceResult;
    try {
      const res = await this.fetchFn(state.url, { signal: controller.signal });
      if (!res.ok) next = { status: "error", msg: `HTTP ${res.status}` };
      else next = { status: "ok", body: decodeBody(await res.text()) };
      // An injected fetch may resolve after ignoring abort. It still missed the deadline and must
      // not turn a timed-out attempt into a late success.
      if (timedOut) next = { status: "error", msg: `Fetch timed out after ${FETCH_TIMEOUT_MS} ms` };
    } catch (err) {
      next = timedOut
        ? { status: "error", msg: `Fetch timed out after ${FETCH_TIMEOUT_MS} ms` }
        : { status: "error", msg: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timeout);
      state.inFlight = false;
      if (state.controller === controller) state.controller = null;
    }

    if (!this.isCurrent(state)) return;
    this.results[state.nodeId] = next;
    this.onUpdate();
    if (next.status === "ok") {
      state.failures = 0;
      this.schedule(state, state.intervalMs);
    } else {
      state.failures += 1;
      this.schedule(state, retryDelay(state.intervalMs, state.failures));
    }
  }
}
