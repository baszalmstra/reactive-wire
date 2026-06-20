import type { NodeData } from "../../shared/node-types.js";
import type { SourceMap, SourceResult } from "../../shared/engine/evaluate.js";

/** A minimal HTTP fetch the poller depends on, so tests can inject a mock with no network. */
export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** How an async source node is configured: where to fetch and how often. */
interface FetchConfig {
  url: string;
  intervalMs: number;
}

const MIN_INTERVAL_MS = 1_000;

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

/**
 * Drives the async data-source nodes in a deployed graph. For each fetch node it polls its URL
 * on the node's interval, decodes the body, and writes the latest result into a source map the
 * engine reads. The fetching lives entirely here, at the edge: the core recompute stays
 * synchronous and just reads the last value. Whenever a fetch lands (success or failure) the
 * onUpdate callback fires so the runtime can recompute and reconcile sinks.
 *
 * State while a source is in flight is expressed through the value model the engine already
 * uses: a node with no result yet reads as unavailable (loading); a failed fetch reads as an
 * error carrying the reason; a successful fetch carries the decoded body.
 */
export class Poller {
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly results: Record<string, SourceResult> = {};
  private readonly sequence: Record<string, number> = {};
  private generation = 0;

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly onUpdate: () => void,
  ) {}

  /** The latest fetched result per source node, for handing to evaluate(). */
  sources(): SourceMap {
    return this.results;
  }

  /**
   * Begin polling the fetch nodes in a graph, replacing any previous schedule. Each source
   * starts unavailable (loading) and fetches immediately, then on its configured interval.
   */
  start(nodes: NodeData[]): void {
    this.stop();
    for (const n of nodes) {
      if (n.type !== "fetch") continue;
      const cfg = fetchConfig(n);
      if (!cfg) {
        // A source with no URL set stays unavailable rather than polling nothing.
        this.results[n.id] = { status: "unavailable" };
        continue;
      }
      this.results[n.id] = { status: "unavailable" };
      this.startPoll(n.id, cfg.url);
      this.timers.push(setInterval(() => this.startPoll(n.id, cfg.url), cfg.intervalMs));
    }
  }

  /** Stop every poll timer and forget all fetched results. */
  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
    this.generation += 1;
    for (const k of Object.keys(this.results)) delete this.results[k];
    for (const k of Object.keys(this.sequence)) delete this.sequence[k];
  }

  private startPoll(nodeId: string, url: string): void {
    const seq = (this.sequence[nodeId] ?? 0) + 1;
    this.sequence[nodeId] = seq;
    void this.poll(nodeId, url, this.generation, seq);
  }

  private async poll(nodeId: string, url: string, generation: number, seq: number): Promise<void> {
    let next: SourceResult;
    try {
      const res = await this.fetchFn(url);
      if (!res.ok) next = { status: "error", msg: `HTTP ${res.status}` };
      else next = { status: "ok", body: decodeBody(await res.text()) };
    } catch (err) {
      next = { status: "error", msg: err instanceof Error ? err.message : String(err) };
    }
    // Intervals can overlap. Once a newer request for the same node has started (or the graph
    // has been stopped/replaced), this response is stale and must not overwrite the newer value.
    if (generation !== this.generation || this.sequence[nodeId] !== seq) return;
    this.results[nodeId] = next;
    this.onUpdate();
  }
}
