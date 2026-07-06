import { describe, expect, it } from "vitest";
import { constNode, graphNode, pin, runGraph, wire } from "./graph-fixtures.js";

describe("graph test fixtures", () => {
  it("builds a minimal runtime graph without canvas-shaped boilerplate in the test", () => {
    const a = constNode("a", "num", 2);
    const b = constNode("b", "num", 3);
    const sum = graphNode({
      id: "sum",
      type: "sum",
      inputs: [pin("in0", "num"), pin("in1", "num")],
      outputs: [pin("out", "num")],
    });

    const result = runGraph({
      nodes: [a, b, sum],
      edges: [wire("e1", "a", "out", "sum", "in0"), wire("e2", "b", "out", "sum", "in1")],
    });

    expect(result.outputs["sum:out"]).toEqual({ type: "num", v: 5, status: "ok" });
  });
});
