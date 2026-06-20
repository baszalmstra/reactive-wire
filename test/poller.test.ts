import { describe, it, expect, vi } from "vitest";
import { Poller, type FetchFn } from "../src/server/poller.js";
import { Deployer } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";
import type { NodeData } from "../shared/node-types.js";
import type { ViewEdge } from "../shared/engine/evaluate.js";

// The poller fetches async data sources at the edge with no real network — every test injects a
// mock fetch and waits for the in-flight promise chain to settle.

/** Resolve a successful fetch with the given body text. */
const okText = (body: string): ReturnType<FetchFn> =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });

/** Let any queued microtasks (the poll promise chain) run to completion. */
const flush = () => new Promise((r) => setTimeout(r, 0));
const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function fetchNode(id: string, cfg: Record<string, unknown>): NodeData {
  return {
    id, type: "fetch", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: cfg,
    inputs: [],
    outputs: [{ id: "value", label: "", type: "num" }],
  };
}

describe("Poller", () => {
  it("starts a source unavailable then fills it from the first fetch", async () => {
    const fetchFn = vi.fn<FetchFn>(() => okText("19.5"));
    const p = new Poller(fetchFn, () => {});
    p.start([fetchNode("f", { url: "http://x", interval: 60 })]);

    expect(p.sources()["f"]).toEqual({ status: "unavailable" });
    await flush();
    expect(p.sources()["f"]).toEqual({ status: "ok", body: 19.5 });
    expect(fetchFn).toHaveBeenCalledWith("http://x");
    p.stop();
  });

  it("records an error result when the response is not ok", async () => {
    const fetchFn: FetchFn = () => Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve("") });
    const p = new Poller(fetchFn, () => {});
    p.start([fetchNode("f", { url: "http://x" })]);
    await flush();
    expect(p.sources()["f"]).toEqual({ status: "error", msg: "HTTP 503" });
    p.stop();
  });

  it("records an error result when the fetch throws", async () => {
    const fetchFn: FetchFn = () => Promise.reject(new Error("network down"));
    const p = new Poller(fetchFn, () => {});
    p.start([fetchNode("f", { url: "http://x" })]);
    await flush();
    expect(p.sources()["f"]).toEqual({ status: "error", msg: "network down" });
    p.stop();
  });

  it("leaves a source with no url unavailable and never fetches it", async () => {
    const fetchFn = vi.fn<FetchFn>(() => okText("1"));
    const p = new Poller(fetchFn, () => {});
    p.start([fetchNode("f", { url: "" })]);
    await flush();
    expect(p.sources()["f"]).toEqual({ status: "unavailable" });
    expect(fetchFn).not.toHaveBeenCalled();
    p.stop();
  });

  it("notifies on each completed fetch and forgets results on stop", async () => {
    const onUpdate = vi.fn();
    const p = new Poller(() => okText("7"), onUpdate);
    p.start([fetchNode("f", { url: "http://x" })]);
    await flush();
    expect(onUpdate).toHaveBeenCalled();
    p.stop();
    expect(p.sources()["f"]).toBeUndefined();
  });

  it("ignores a stale older response after a newer overlapping request has updated the source", async () => {
    vi.useFakeTimers();
    let p: Poller | null = null;
    try {
      const pending: Array<(value: Awaited<ReturnType<FetchFn>>) => void> = [];
      const fetchFn = vi.fn<FetchFn>(() => new Promise((resolve) => pending.push(resolve)));
      const onUpdate = vi.fn();
      p = new Poller(fetchFn, onUpdate);
      p.start([fetchNode("f", { url: "http://x", interval: 0.001 })]);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      // User-configured fetch intervals are clamped to at least one second to avoid accidental
      // tight polling loops, but unresolved requests may still overlap with the next scheduled
      // poll. The older response must not overwrite the newer value.
      vi.advanceTimersByTime(1000);
      expect(fetchFn).toHaveBeenCalledTimes(2);

      pending[1]!({ ok: true, status: 200, text: () => Promise.resolve("2") });
      await flushMicrotasks();
      expect(p.sources()["f"]).toEqual({ status: "ok", body: 2 });
      expect(onUpdate).toHaveBeenCalledTimes(1);

      pending[0]!({ ok: true, status: 200, text: () => Promise.resolve("1") });
      await flushMicrotasks();
      expect(p.sources()["f"]).toEqual({ status: "ok", body: 2 });
      expect(onUpdate).toHaveBeenCalledTimes(1);
    } finally {
      p?.stop();
      vi.useRealTimers();
    }
  });
});

describe("Deployer with a fetch source", () => {
  // A fetched number above a threshold turns a light on; the sink must hold while the source is
  // still loading and only actuate once the fetch lands.
  const nodes: NodeData[] = [
    fetchNode("f", { url: "http://temp", interval: 60, path: "" }),
    { id: "cmp", type: "compare", title: "", subtitle: "", icon: "cmp", x: 0, y: 0, config: { op: ">" }, typeGroup: ["a", "b"], values: { b: 20 }, inputs: [{ id: "a", label: "", type: "any", editable: true }, { id: "b", label: "", type: "any", editable: true }], outputs: [{ id: "result", label: "", type: "bool" }] },
    { id: "light", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "light.lr" }, inputs: [{ id: "on", label: "", type: "bool" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [
    { id: "e1", from: { node: "f", pin: "value" }, to: { node: "cmp", pin: "a" } },
    { id: "e2", from: { node: "cmp", pin: "result" }, to: { node: "light", pin: "on" } },
  ];

  it("holds the sink while loading, then actuates from the fetched value", async () => {
    const ha = new MockHA();
    const deployer = new Deployer(ha, 100_000, () => okText("25"));
    deployer.deploy(nodes, edges, true);

    // Before the first fetch lands the source is unavailable, so the comparison is undetermined
    // and the sink holds — nothing was called.
    expect(ha.calls).toHaveLength(0);

    await flush();
    // The fetch resolved to 25 (> 20): the light turns on, driven by an async data source.
    expect(ha.lastCall()?.service).toBe("turn_on");
    expect(ha.lastCall()?.target?.entity_id).toBe("light.lr");
    deployer.stop();
  });
});
