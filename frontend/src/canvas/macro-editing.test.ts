import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { NodeData } from "../../../shared/node-types.js";
import { MACRO_IN, MACRO_OUT, makeMacroInstance, type MacroDef, type MacroMap } from "../../../shared/macros.js";
import type { RWNodeType } from "./validation.js";
import { macroBoundaryPins, macroDefFromFlow, macroDefToFlow, syncMacroInstance } from "./macro-editing.js";

function node(id: string, type = "const-number"): NodeData {
  return {
    id,
    type,
    title: id,
    subtitle: "",
    icon: "const",
    x: 10,
    y: 20,
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "num" }],
  };
}

function boundaryIn(id: string, label = "input"): NodeData {
  return { id, type: MACRO_IN, title: "Input", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "in", label, type: "bool" }] };
}

function boundaryOut(id: string, label = "output"): NodeData {
  return { id, type: MACRO_OUT, title: "Output", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "out", label, type: "num" }], outputs: [] };
}

function rf(def: NodeData, x = def.x, y = def.y): RWNodeType {
  return { id: def.id, type: "rw", position: { x, y }, dragHandle: ".rw-drag", data: { def } } as RWNodeType;
}

describe("macro editing module", () => {
  it("converts a macro definition to a React Flow editing graph", () => {
    const def: MacroDef = {
      id: "m",
      name: "Macro",
      inputs: [],
      outputs: [],
      nodes: [node("n")],
      edges: [{ id: "e", from: { node: "n", pin: "out" }, to: { node: "out", pin: "out" } }],
      stateful: false,
    };

    const flow = macroDefToFlow(def);

    expect(flow.nodes[0]).toMatchObject({ id: "n", type: "rw", position: { x: 10, y: 20 } });
    expect(flow.edges[0]).toMatchObject({ id: "e", source: "n", sourceHandle: "out", target: "out", targetHandle: "out", animated: true });
  });

  it("derives the macro interface from boundary nodes", () => {
    expect(macroBoundaryPins([boundaryIn("in"), boundaryOut("out"), node("inner")])).toEqual({
      inputs: [{ id: "in", label: "input", type: "bool" }],
      outputs: [{ id: "out", label: "output", type: "num" }],
    });
  });

  it("saves a macro definition from the edited flow with live positions and boundary interface", () => {
    const original: MacroDef = { id: "m", name: "Old", inputs: [], outputs: [], nodes: [], edges: [], stateful: false };
    const nodes = [rf(boundaryIn("in"), 11, 22), rf(node("inner"), 33, 44), rf(boundaryOut("out"), 55, 66)];
    const edges: Edge[] = [{ id: "e", source: "in", sourceHandle: "in", target: "inner", targetHandle: "x" }];

    const saved = macroDefFromFlow({ original, name: " New ", nodes, edges, macros: {} });

    expect(saved.name).toBe("New");
    expect(saved.inputs.map((p) => p.id)).toEqual(["in"]);
    expect(saved.outputs.map((p) => p.id)).toEqual(["out"]);
    expect(saved.nodes.find((n) => n.id === "inner")).toMatchObject({ x: 33, y: 44 });
    expect(saved.edges).toEqual([{ id: "e", from: { node: "in", pin: "in" }, to: { node: "inner", pin: "x" } }]);
  });

  it("syncs a macro placement interface while preserving placement config", () => {
    const def: MacroDef = {
      id: "m",
      name: "Updated",
      inputs: [{ id: "a", label: "A", type: "str" }],
      outputs: [{ id: "b", label: "B", type: "bool" }],
      nodes: [],
      edges: [],
      stateful: false,
    };
    const macros: MacroMap = { m: def };
    const placement = makeMacroInstance({ ...def, name: "Old", inputs: [], outputs: [] }, "inst", 1, 2);

    const synced = syncMacroInstance(placement, macros);

    expect(synced.title).toBe("Updated");
    expect(synced.config?.macroId).toBe("m");
    expect(synced.inputs).toEqual([{ id: "a", label: "A", type: "str", editable: true }]);
    expect(synced.outputs).toEqual([{ id: "b", label: "B", type: "bool" }]);
  });
});
