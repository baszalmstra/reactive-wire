import { describe, it, expect } from "vitest";
import { evaluate, sinkCalls, type Memory, type SourceMap, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";

// The async data-source node reads whatever a poller last fetched for it, looked up by node id
// and supplied to evaluate() through the source map. These tests exercise the engine's reading
// of that map directly (no poller, no network); poller.test.ts covers the fetching itself.

function fetchNode(id: string, cfg: Record<string, unknown> = {}, type: "num" | "str" | "bool" = "num"): NodeData {
  return {
    id, type: "fetch", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: cfg,
    inputs: [],
    outputs: [{ id: "value", label: "", type }],
  };
}

const out = (n: NodeData, sources: SourceMap) =>
  evaluate([n], [], {}, {} as Memory, 0, sources).outputs[`${n.id}:value`]!;

describe("fetch node — reading a fetched source", () => {
  it("is unavailable (loading) when nothing has been fetched yet", () => {
    const n = fetchNode("f");
    expect(out(n, {}).status).toBe("unavailable");
    expect(out(n, { f: { status: "unavailable" } }).status).toBe("unavailable");
  });

  it("is an error when the last fetch failed, carrying the reason", () => {
    const n = fetchNode("f");
    const v = out(n, { f: { status: "error", msg: "HTTP 503" } });
    expect(v.status).toBe("error");
    expect(v.msg).toBe("HTTP 503");
  });

  it("parses the whole body to the output type when no path is set", () => {
    const n = fetchNode("f", { path: "" }, "num");
    expect(out(n, { f: { status: "ok", body: 21.5 } })).toEqual({ type: "num", v: 21.5, status: "ok" });
  });

  it("reads a dot path out of a JSON body", () => {
    const n = fetchNode("f", { path: "main.temp" }, "num");
    expect(out(n, { f: { status: "ok", body: { main: { temp: 18 } } } }).v).toBe(18);
  });

  it("indexes into arrays along the path", () => {
    const n = fetchNode("f", { path: "results.1.value" }, "num");
    const body = { results: [{ value: 1 }, { value: 2 }] };
    expect(out(n, { f: { status: "ok", body } }).v).toBe(2);
  });

  it("reads as unavailable when the path is absent from the body", () => {
    const n = fetchNode("f", { path: "missing.key" }, "num");
    expect(out(n, { f: { status: "ok", body: { main: { temp: 18 } } } }).status).toBe("unavailable");
  });

  it("coerces a textual on/off body to a boolean", () => {
    const n = fetchNode("f", { path: "" }, "bool");
    expect(out(n, { f: { status: "ok", body: "on" } })).toEqual({ type: "bool", v: true, status: "ok" });
  });
});

describe("fetch node — safety through the sink", () => {
  // A light driven off a still-loading or failed fetch must not actuate, by the sink rule that
  // a non-ok command input is never written.
  const nodes: NodeData[] = [
    fetchNode("f", { path: "" }, "bool"),
    { id: "light", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "light.lr" }, inputs: [{ id: "on", label: "", type: "bool" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "f", pin: "value" }, to: { node: "light", pin: "on" } }];
  const calls = (sources: SourceMap) => sinkCalls(nodes, evaluate(nodes, edges, {}, {} as Memory, 0, sources));

  it("does not actuate while the source is still loading", () => {
    expect(calls({})).toHaveLength(0);
  });

  it("does not actuate when the source errored", () => {
    expect(calls({ f: { status: "error", msg: "boom" } })).toHaveLength(0);
  });

  it("actuates once the source resolves to a concrete value", () => {
    const c = calls({ f: { status: "ok", body: "on" } });
    expect(c).toHaveLength(1);
    expect(c[0]!.call.service).toBe("turn_on");
  });
});
