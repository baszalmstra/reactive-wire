import { describe, expect, it } from "vitest";
import { appendPath, decodePath, decodePinKey, pinKey } from "../shared/identity.js";
import { combineFlowGraphs } from "../shared/engine/flow-graphs.js";
import { expandMacros } from "../shared/engine/expand.js";
import type { NodeData } from "../shared/node-types.js";

function constant(id: string): NodeData {
  return {
    id,
    type: "const-number",
    title: "Number",
    subtitle: "",
    icon: "const",
    x: 0,
    y: 0,
    values: { out: 1 },
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "num" }],
  };
}

describe("graph identities", () => {
  it("round-trips pin and path identities while preserving ordinary text", () => {
    expect(pinKey("light", "on")).toBe("light:on");
    expect(decodePinKey(pinKey("a:b", "c%d"))).toEqual({ nodeId: "a:b", pinId: "c%d" });
    const path = appendPath(appendPath("", "a/b"), "c%d");
    expect(path).toBe("a%2Fb/c%25d");
    expect(decodePath(path)).toEqual(["a/b", "c%d"]);
  });

  it("does not alias a raw slash id with a macro instance path", () => {
    const placement: NodeData = {
      id: "a",
      type: "macro",
      title: "Macro",
      subtitle: "",
      icon: "macro",
      x: 0,
      y: 0,
      config: { macroId: "m" },
      inputs: [],
      outputs: [],
    };
    const expanded = expandMacros(
      [constant("a/b"), placement],
      [],
      { m: { id: "m", name: "M", inputs: [], outputs: [], nodes: [constant("b")], edges: [], stateful: false } },
    );

    expect(expanded.nodes.map((node) => node.id)).toEqual(["a%2Fb", "a/b"]);
    expect(new Set(expanded.nodes.map((node) => node.id)).size).toBe(2);
  });

  it("does not alias delimiter-containing flow and node paths", () => {
    const graph = combineFlowGraphs([
      { flowId: "a/b", nodes: [constant("c")], edges: [] },
      { flowId: "a", nodes: [constant("b/c")], edges: [] },
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual(["a%2Fb/c", "a/b%2Fc"]);
    expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(2);
  });
});
