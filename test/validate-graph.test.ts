import { describe, expect, it } from "vitest";
import type { NodeData } from "../shared/node-types.js";
import type { ViewEdge } from "../shared/engine/evaluate.js";
import { validateExpandedGraph, validateReachableMacros } from "../shared/engine/validate-graph.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";

function numberNode(id: string): NodeData {
  return {
    id,
    type: "const-number",
    title: "Number",
    subtitle: "",
    icon: "const",
    x: 0,
    y: 0,
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "num", editable: true }],
    values: { out: 1 },
  };
}

function notNode(id: string): NodeData {
  return {
    id,
    type: "not",
    title: "NOT",
    subtitle: "",
    icon: "cmp",
    x: 0,
    y: 0,
    inputs: [{ id: "in", label: "in", type: "bool" }],
    outputs: [{ id: "out", label: "not", type: "bool" }],
  };
}

function edge(id: string, from: string, to: string): ViewEdge {
  return { id, from: { node: from, pin: "out" }, to: { node: to, pin: "in" } };
}

describe("shared graph semantics", () => {
  it("accepts a canonical typed DAG", () => {
    expect(validateExpandedGraph([notNode("a"), notNode("b")], [edge("e", "a", "b")])).toEqual({ ok: true });
  });

  it("rejects unknown node types and non-canonical static pins", () => {
    expect(validateExpandedGraph([{ ...numberNode("n"), type: "not-registered" }], [])).toMatchObject({ ok: false });
    const spoofed = numberNode("n");
    spoofed.outputs[0] = { ...spoofed.outputs[0]!, type: "bool" };
    const result = validateExpandedGraph([spoofed], []);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error.code).toBe("invalid-pin");
  });

  it("rejects missing endpoints, wrong directions, and incompatible types", () => {
    const missing = validateExpandedGraph([numberNode("n"), notNode("not")], [
      { id: "e", from: { node: "n", pin: "missing" }, to: { node: "not", pin: "in" } },
    ]);
    expect(missing).toMatchObject({ ok: false });
    if (!missing.ok) expect(missing.error.code).toBe("invalid-edge");

    const wrongDirection = validateExpandedGraph([notNode("a"), notNode("b")], [
      { id: "e", from: { node: "a", pin: "in" }, to: { node: "b", pin: "in" } },
    ]);
    expect(wrongDirection).toMatchObject({ ok: false });

    const mismatch = validateExpandedGraph([numberNode("n"), notNode("not")], [edge("e", "n", "not")]);
    expect(mismatch).toMatchObject({ ok: false });
    if (!mismatch.ok) expect(mismatch.error.code).toBe("type-mismatch");
  });

  it("enforces concrete equality within generic type groups", () => {
    const number = REGISTRY["const-number"]!.template.make("number");
    const duration = REGISTRY["const-duration"]!.template.make("duration");
    const target = REGISTRY.between!.template.make("between");
    const mixed = validateExpandedGraph([number, duration, target], [
      { id: "number-value", from: { node: "number", pin: "out" }, to: { node: "between", pin: "value" } },
      { id: "duration-min", from: { node: "duration", pin: "out" }, to: { node: "between", pin: "min" } },
    ]);
    expect(mixed).toMatchObject({ ok: false });
    if (!mixed.ok) expect(mixed.error.code).toBe("type-mismatch");

    const otherNumber = REGISTRY["const-number"]!.template.make("other-number");
    expect(validateExpandedGraph([number, otherNumber, target], [
      { id: "number-value", from: { node: "number", pin: "out" }, to: { node: "between", pin: "value" } },
      { id: "number-min", from: { node: "other-number", pin: "out" }, to: { node: "between", pin: "min" } },
    ])).toEqual({ ok: true });

    const compare = REGISTRY.compare!.template.make("compare");
    expect(validateExpandedGraph([number, otherNumber, compare], [
      { id: "compare-a", from: { node: "number", pin: "out" }, to: { node: "compare", pin: "a" } },
      { id: "compare-b", from: { node: "other-number", pin: "out" }, to: { node: "compare", pin: "b" } },
    ])).toEqual({ ok: true });

    const condition = REGISTRY["const-bool"]!.template.make("condition");
    const select = REGISTRY.select!.template.make("select");
    expect(validateExpandedGraph([number, duration, condition, select], [
      { id: "select-condition", from: { node: "condition", pin: "out" }, to: { node: "select", pin: "cond" } },
      { id: "select-number", from: { node: "number", pin: "out" }, to: { node: "select", pin: "a" } },
      { id: "select-duration", from: { node: "duration", pin: "out" }, to: { node: "select", pin: "b" } },
    ])).toEqual({ ok: true });
  });

  it("rejects duplicate input wiring regardless of edge order", () => {
    const nodes = [notNode("a"), notNode("b"), notNode("target")];
    const edges = [edge("first", "a", "target"), edge("second", "b", "target")];
    for (const ordered of [edges, [...edges].reverse()]) {
      const result = validateExpandedGraph(nodes, ordered);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error.code).toBe("duplicate-input-source");
    }
  });

  it("rejects cycles", () => {
    const result = validateExpandedGraph(
      [notNode("a"), notNode("b")],
      [edge("ab", "a", "b"), edge("ba", "b", "a")],
    );
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error.code).toBe("cycle");
  });

  it("validates a near-budget chain without quadratic cycle searches", () => {
    const count = 10_000;
    const nodes = Array.from({ length: count }, (_, index) => notNode(`n${index}`));
    const edges = Array.from({ length: count - 1 }, (_, index) => edge(`e${index}`, `n${index}`, `n${index + 1}`));
    const started = performance.now();

    expect(validateExpandedGraph(nodes, edges)).toEqual({ ok: true });
    // The prior per-edge reachability search took about 2.6s for this shape on the review host.
    // Keep a deliberately generous bound: the linear pass is normally well below 200ms.
    expect(performance.now() - started).toBeLessThan(2_000);
  }, 10_000);

  it("rejects unknown and recursively dependent macros before expansion", () => {
    const placement = { ...numberNode("placement"), type: "macro", config: { macroId: "missing" } };
    expect(validateReachableMacros([placement], {})).toMatchObject({ ok: false });

    const recursivePlacement = { ...numberNode("inner"), type: "macro", config: { macroId: "loop" } };
    const recursive = validateReachableMacros(
      [{ ...numberNode("root"), type: "macro", config: { macroId: "loop" } }],
      { loop: { id: "loop", name: "Loop", inputs: [], outputs: [], nodes: [recursivePlacement], edges: [], stateful: false } },
    );
    expect(recursive).toMatchObject({ ok: false });
    if (!recursive.ok) expect(recursive.error.code).toBe("recursive-macro");
  });
});
