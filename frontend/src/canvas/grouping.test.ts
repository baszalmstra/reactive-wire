import { describe, expect, it } from "vitest";
import type { NodeData, PinDef } from "../../../shared/node-types.js";
import type { ValueType } from "../../../shared/theme.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";
import { MACRO_IN, MACRO_OUT } from "../../../shared/macros.js";
import { groupSelection } from "./grouping.js";

let seq = 0;
function node(id: string, inputs: PinDef[], outputs: PinDef[], x = 0, y = 0): NodeData {
  return { id, type: "const", title: id, subtitle: "", icon: "const", x, y, inputs, outputs };
}
function pin(id: string, type: ValueType = "num", label = id): PinDef {
  return { id, label, type };
}
function wire(from: [string, string], to: [string, string]): ViewEdge {
  return { id: `e${seq++}`, from: { node: from[0], pin: from[1] }, to: { node: to[0], pin: to[1] } };
}

const at = { x: 500, y: 500 };

describe("groupSelection", () => {
  it("derives one boundary input and output from a wire crossing each side of the selection", () => {
    const src = node("src", [], [pin("out", "num")]);
    const sel = node("sel", [pin("in", "num", "threshold")], [pin("res", "bool", "hit")], 100, 100);
    const dst = node("dst", [pin("cin", "bool")], []);
    const edges = [wire(["src", "out"], ["sel", "in"]), wire(["sel", "res"], ["dst", "cin"])];

    const r = groupSelection([src, sel, dst], edges, ["sel"], {}, at);

    expect(r).not.toBeNull();
    expect(r!.def.inputs).toEqual([{ id: "in0", label: "threshold", type: "num" }]);
    expect(r!.def.outputs).toEqual([{ id: "out0", label: "hit", type: "bool" }]);
    // The definition keeps the selected node plus a boundary node per interface pin.
    expect(r!.def.nodes.filter((n) => n.type === MACRO_IN)).toHaveLength(1);
    expect(r!.def.nodes.filter((n) => n.type === MACRO_OUT)).toHaveLength(1);
    expect(r!.def.nodes.some((n) => n.id === "sel")).toBe(true);
    // The placement mirrors the boundary and is wired to the same neighbors on the parent canvas.
    expect(r!.instance.type).toBe("macro");
    expect(r!.instance.inputs.map((p) => p.type)).toEqual(["num"]);
    expect(r!.instance.outputs.map((p) => p.type)).toEqual(["bool"]);
    expect(r!.removedNodeIds).toEqual(["sel"]);
    expect(r!.removedEdgeIds).toEqual(edges.map((e) => e.id));
    const rewired = r!.newEdges.map((e) => ({ from: e.from, to: e.to }));
    expect(rewired).toContainEqual({ from: { node: "src", pin: "out" }, to: { node: r!.instance.id, pin: "in0" } });
    expect(rewired).toContainEqual({ from: { node: r!.instance.id, pin: "out0" }, to: { node: "dst", pin: "cin" } });
  });

  it("produces no boundary pins when the selection has no wires crossing it", () => {
    const a = node("a", [], [pin("out", "num")], 0, 0);
    const b = node("b", [pin("in", "num")], [], 200, 0);
    // The only edge is wholly inside the selection, so it moves into the definition, not the boundary.
    const internal = wire(["a", "out"], ["b", "in"]);

    const r = groupSelection([a, b], [internal], ["a", "b"], {}, at);

    expect(r).not.toBeNull();
    expect(r!.def.inputs).toEqual([]);
    expect(r!.def.outputs).toEqual([]);
    expect(r!.def.nodes.some((n) => n.type === MACRO_IN || n.type === MACRO_OUT)).toBe(false);
    expect(r!.def.edges.map((e) => e.id)).toEqual([internal.id]);
    expect(r!.newEdges).toEqual([]);
    expect(r!.removedEdgeIds).toEqual([internal.id]);
  });

  it("collapses several inner consumers of one external source into a single boundary input", () => {
    const src = node("src", [], [pin("out", "num")]);
    const c1 = node("c1", [pin("in", "num")], [], 100, 0);
    const c2 = node("c2", [pin("in", "num")], [], 100, 200);
    const edges = [wire(["src", "out"], ["c1", "in"]), wire(["src", "out"], ["c2", "in"])];

    const r = groupSelection([src, c1, c2], edges, ["c1", "c2"], {}, at);

    expect(r).not.toBeNull();
    // Two inner consumers, one shared external source pin → exactly one macro input.
    expect(r!.def.inputs).toHaveLength(1);
    const boundaryIn = r!.def.nodes.find((n) => n.type === MACRO_IN)!;
    const fedConsumers = r!.def.edges.filter((e) => e.from.node === boundaryIn.id).map((e) => e.to.node).sort();
    expect(fedConsumers).toEqual(["c1", "c2"]);
    // On the parent canvas the two crossings dedupe to a single source→placement wire.
    expect(r!.newEdges).toHaveLength(1);
    expect(r!.newEdges[0]!.from).toEqual({ node: "src", pin: "out" });
  });

  it("propagates the crossing pins' declared types onto the boundary interface", () => {
    const src = node("src", [], [pin("tint", "color")]);
    const sel = node("sel", [pin("swatch", "color")], [pin("wait", "duration")], 100, 0);
    const dst = node("dst", [pin("delay", "duration")], []);
    const edges = [wire(["src", "tint"], ["sel", "swatch"]), wire(["sel", "wait"], ["dst", "delay"])];

    const r = groupSelection([src, sel, dst], edges, ["sel"], {}, at);

    expect(r!.def.inputs[0]!.type).toBe("color");
    expect(r!.def.outputs[0]!.type).toBe("duration");
    // The boundary nodes carry the same typed pin the interface exposes.
    const macroIn = r!.def.nodes.find((n) => n.type === MACRO_IN)!;
    const macroOut = r!.def.nodes.find((n) => n.type === MACRO_OUT)!;
    expect(macroIn.outputs[0]!.type).toBe("color");
    expect(macroOut.inputs[0]!.type).toBe("duration");
  });
});
