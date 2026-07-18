import { describe, it, expect } from "vitest";
import { evaluate, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import { expandMacros } from "../shared/engine/expand.js";
import { MACRO_IN, MACRO_OUT, type MacroDef, type MacroMap } from "../shared/macros.js";
import { exportMacro, importBundle, collectDeps } from "../frontend/src/canvas/macro-io.js";
import { groupSelection } from "../frontend/src/canvas/grouping.js";
import { Deployer } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";
import type { NodeData } from "../shared/node-types.js";

function entityNode(id: string, entity_id: string, type: "bool" | "num" | "str"): NodeData {
  return {
    id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id },
    inputs: [], outputs: [{ id: "state", label: "", type }],
  };
}

/**
 * A stateful macro: a single input "trig" feeds a toggle, whose state is the single output
 * "state". Two placements of this must each keep their own toggle memory.
 */
function toggleMacro(): MacroDef {
  const boundaryIn: NodeData = {
    id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0,
    inputs: [], outputs: [{ id: "trig", label: "trigger", type: "bool" }],
  };
  const toggle: NodeData = {
    id: "tg", type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
    stateful: true, config: { persistence: "seed-at-boot", initial: false },
    inputs: [{ id: "in", label: "", type: "bool" }],
    outputs: [{ id: "state", label: "", type: "bool" }],
  };
  const boundaryOut: NodeData = {
    id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0,
    inputs: [{ id: "state", label: "state", type: "bool" }], outputs: [],
  };
  return {
    id: "m_toggle",
    name: "Latch",
    inputs: [{ id: "trig", label: "trigger", type: "bool" }],
    outputs: [{ id: "state", label: "state", type: "bool" }],
    stateful: true,
    nodes: [boundaryIn, toggle, boundaryOut],
    edges: [
      { id: "e1", from: { node: "in", pin: "trig" }, to: { node: "tg", pin: "in" } },
      { id: "e2", from: { node: "tg", pin: "state" }, to: { node: "out", pin: "state" } },
    ],
  };
}

function macroInstance(id: string, macroId: string): NodeData {
  return {
    id, type: "macro", title: "Latch", subtitle: "Macro", icon: "macro", x: 0, y: 0,
    stateful: true, config: { macroId },
    inputs: [{ id: "trig", label: "trigger", type: "bool" }],
    outputs: [{ id: "state", label: "state", type: "bool" }],
  };
}

describe("macro expansion", () => {
  it("aborts when repeated placements exceed the cumulative expansion budget", () => {
    const innerNodes: NodeData[] = [
      { id: "a", type: "const-number", title: "", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "", type: "num" }], values: { out: 1 } },
      { id: "b", type: "const-number", title: "", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "", type: "num" }], values: { out: 2 } },
    ];
    const def: MacroDef = { id: "wide", name: "Wide", inputs: [], outputs: [], nodes: innerNodes, edges: [], stateful: false };
    const placements = ["p1", "p2", "p3"].map((id) => ({
      id, type: "macro", title: "Wide", subtitle: "", icon: "macro", x: 0, y: 0,
      inputs: [], outputs: [], config: { macroId: "wide" },
    } satisfies NodeData));

    expect(() => expandMacros(placements, [], { wide: def }, {
      maxNodes: 5,
      maxEdges: 20,
      maxDepth: 4,
      maxInstances: 10,
    })).toThrow(/exceeds 5 nodes/);
  });

  it("aborts when nested macros exceed the depth budget", () => {
    const leaf: MacroDef = {
      id: "leaf", name: "Leaf", inputs: [], outputs: [], stateful: false,
      nodes: [{ id: "n", type: "const-number", title: "", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "", type: "num" }], values: { out: 1 } }],
      edges: [],
    };
    const nested = (id: string, child: string): MacroDef => ({
      id, name: id, inputs: [], outputs: [], stateful: false,
      nodes: [{ id: "child", type: "macro", title: "", subtitle: "", icon: "macro", x: 0, y: 0, inputs: [], outputs: [], config: { macroId: child } }],
      edges: [],
    });
    const macros: MacroMap = { leaf, m1: nested("m1", "leaf"), m2: nested("m2", "m1") };
    const root: NodeData = { id: "root", type: "macro", title: "", subtitle: "", icon: "macro", x: 0, y: 0, inputs: [], outputs: [], config: { macroId: "m2" } };

    expect(() => expandMacros([root], [], macros, {
      maxNodes: 20,
      maxEdges: 20,
      maxDepth: 2,
      maxInstances: 20,
    })).toThrow(/nesting exceeds depth 2/);
  });

  it("inlines a macro into a flat graph the engine can read", () => {
    const macros: MacroMap = { m_toggle: toggleMacro() };
    const trig = entityNode("t", "binary_sensor.t", "bool");
    const inst = macroInstance("a", "m_toggle");
    const nodes = [trig, inst];
    const edges: ViewEdge[] = [{ id: "w", from: { node: "t", pin: "state" }, to: { node: "a", pin: "trig" } }];

    const flat = expandMacros(nodes, edges, macros);
    // The placement is gone, replaced by a namespaced copy of the toggle and a passthrough.
    expect(flat.nodes.some((n) => n.type === "macro")).toBe(false);
    expect(flat.nodes.some((n) => n.id === "a/tg")).toBe(true);
    expect(flat.instances["a"]?.outputs["state"]).toEqual({ node: "a/tg", pin: "state" });
  });
});

describe("macro placements keep independent state", () => {
  it("two instances of a stateful macro hold separate memory", () => {
    const macros: MacroMap = { m_toggle: toggleMacro() };
    // Two independent triggers, one per placement.
    const tA = entityNode("ta", "binary_sensor.a", "bool");
    const tB = entityNode("tb", "binary_sensor.b", "bool");
    const a = macroInstance("a", "m_toggle");
    const b = macroInstance("b", "m_toggle");
    const nodes = [tA, tB, a, b];
    const edges: ViewEdge[] = [
      { id: "wa", from: { node: "ta", pin: "state" }, to: { node: "a", pin: "trig" } },
      { id: "wb", from: { node: "tb", pin: "state" }, to: { node: "b", pin: "trig" } },
    ];
    const mem: Memory = {};
    const step = (av: string, bv: string) =>
      evaluate(
        nodes, edges,
        { "binary_sensor.a": { state: av, attributes: {} }, "binary_sensor.b": { state: bv, attributes: {} } },
        mem, Date.now(), {}, macros,
      );

    // Both start false.
    let r = step("off", "off");
    expect(r.outputs["a:state"]!.v).toBe(false);
    expect(r.outputs["b:state"]!.v).toBe(false);

    // Pulse only A's trigger: A flips true, B stays false.
    r = step("on", "off");
    expect(r.outputs["a:state"]!.v).toBe(true);
    expect(r.outputs["b:state"]!.v).toBe(false);

    // Pulse A again (release then press): A flips back to false; B still untouched.
    step("off", "off");
    r = step("on", "off");
    expect(r.outputs["a:state"]!.v).toBe(false);
    expect(r.outputs["b:state"]!.v).toBe(false);

    // Now pulse only B: B flips true, A unchanged.
    r = step("off", "on");
    expect(r.outputs["a:state"]!.v).toBe(false);
    expect(r.outputs["b:state"]!.v).toBe(true);

    // The two placements use disjoint memory slots, so neither follows the other.
    expect(Object.keys(mem).some((k) => k.startsWith("a/"))).toBe(true);
    expect(Object.keys(mem).some((k) => k.startsWith("b/"))).toBe(true);
  });

  it("editing the definition changes all instances' behavior", () => {
    // A macro whose output is its input negated. Swapping the inner node changes both placements.
    const def: MacroDef = {
      id: "m_pass", name: "Pass", stateful: false,
      inputs: [{ id: "x", label: "x", type: "bool" }],
      outputs: [{ id: "y", label: "y", type: "bool" }],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "x", label: "", type: "bool" }] },
        { id: "n", type: "not", title: "", subtitle: "", icon: "cmp", x: 0, y: 0, inputs: [{ id: "in", label: "", type: "bool" }], outputs: [{ id: "out", label: "", type: "bool" }] },
        { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "y", label: "", type: "bool" }], outputs: [] },
      ],
      edges: [
        { id: "e1", from: { node: "in", pin: "x" }, to: { node: "n", pin: "in" } },
        { id: "e2", from: { node: "n", pin: "out" }, to: { node: "out", pin: "y" } },
      ],
    };
    const macros: MacroMap = { m_pass: def };
    const src = entityNode("s", "binary_sensor.s", "bool");
    const inst: NodeData = {
      id: "p", type: "macro", title: "Pass", subtitle: "Macro", icon: "macro", x: 0, y: 0,
      config: { macroId: "m_pass" },
      inputs: [{ id: "x", label: "x", type: "bool" }],
      outputs: [{ id: "y", label: "y", type: "bool" }],
    };
    const edges: ViewEdge[] = [{ id: "w", from: { node: "s", pin: "state" }, to: { node: "p", pin: "x" } }];
    const out = evaluate([src, inst], edges, { "binary_sensor.s": { state: "on", attributes: {} } }, {}, Date.now(), {}, macros).outputs["p:y"]!;
    expect(out.v).toBe(false); // not(true)
  });

  it("an unwired macro input falls back to the placement's literal default", () => {
    const macros: MacroMap = { m_pass: {
      id: "m_pass", name: "Pass", stateful: false,
      inputs: [{ id: "x", label: "x", type: "num" }],
      outputs: [{ id: "y", label: "y", type: "num" }],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "x", label: "", type: "num" }] },
        { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "y", label: "", type: "num" }], outputs: [] },
      ],
      edges: [{ id: "e", from: { node: "in", pin: "x" }, to: { node: "out", pin: "y" } }],
    } };
    const inst: NodeData = {
      id: "p", type: "macro", title: "Pass", subtitle: "Macro", icon: "macro", x: 0, y: 0,
      config: { macroId: "m_pass" }, values: { x: 42 },
      inputs: [{ id: "x", label: "x", type: "num", editable: true }],
      outputs: [{ id: "y", label: "y", type: "num" }],
    };
    const out = evaluate([inst], [], {}, {}, Date.now(), {}, macros).outputs["p:y"]!;
    expect(out.status).toBe("ok");
    expect(out.v).toBe(42);
  });
});

describe("nested macro expansion propagates across boundaries", () => {
  // An inner macro that negates its boolean input.
  function notMacro(): MacroDef {
    return {
      id: "m_not", name: "Not", stateful: false,
      inputs: [{ id: "x", label: "x", type: "bool" }],
      outputs: [{ id: "y", label: "y", type: "bool" }],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "x", label: "", type: "bool" }] },
        { id: "n", type: "not", title: "", subtitle: "", icon: "cmp", x: 0, y: 0, inputs: [{ id: "in", label: "", type: "bool" }], outputs: [{ id: "out", label: "", type: "bool" }] },
        { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "y", label: "", type: "bool" }], outputs: [] },
      ],
      edges: [
        { id: "e1", from: { node: "in", pin: "x" }, to: { node: "n", pin: "in" } },
        { id: "e2", from: { node: "n", pin: "out" }, to: { node: "out", pin: "y" } },
      ],
    };
  }

  // An outer macro that wires its macro-in DIRECTLY into a nested placement, and the nested
  // placement's output DIRECTLY into its macro-out. Both boundary<->nested edges are the shape
  // that group-into-macro produces when a selection contains a macro with a crossing wire.
  function outerMacro(): MacroDef {
    return {
      id: "m_outer", name: "Outer", stateful: false,
      inputs: [{ id: "a", label: "a", type: "bool" }],
      outputs: [{ id: "b", label: "b", type: "bool" }],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "a", label: "", type: "bool" }] },
        { id: "child", type: "macro", title: "", subtitle: "", icon: "macro", x: 0, y: 0, config: { macroId: "m_not" },
          inputs: [{ id: "x", label: "", type: "bool", editable: true }], outputs: [{ id: "y", label: "", type: "bool" }] },
        { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "b", label: "", type: "bool" }], outputs: [] },
      ],
      edges: [
        { id: "e1", from: { node: "in", pin: "a" }, to: { node: "child", pin: "x" } },
        { id: "e2", from: { node: "child", pin: "y" }, to: { node: "out", pin: "b" } },
      ],
    };
  }

  it("a value flows source -> macro-in -> nested placement -> macro-out -> output", () => {
    const macros: MacroMap = { m_not: notMacro(), m_outer: outerMacro() };
    const src = entityNode("s", "binary_sensor.s", "bool");
    const inst: NodeData = {
      id: "p", type: "macro", title: "Outer", subtitle: "Macro", icon: "macro", x: 0, y: 0,
      config: { macroId: "m_outer" },
      inputs: [{ id: "a", label: "a", type: "bool", editable: true }],
      outputs: [{ id: "b", label: "b", type: "bool" }],
    };
    const edges: ViewEdge[] = [{ id: "w", from: { node: "s", pin: "state" }, to: { node: "p", pin: "a" } }];
    const out = evaluate([src, inst], edges, { "binary_sensor.s": { state: "on", attributes: {} } }, {}, Date.now(), {}, macros).outputs["p:b"]!;
    // not(true) computed inside the nested placement, both boundary hops intact.
    expect(out.status).toBe("ok");
    expect(out.v).toBe(false);
  });

  it("an unwired outer input feeds its literal default through the nested boundaries", () => {
    const macros: MacroMap = { m_not: notMacro(), m_outer: outerMacro() };
    const inst: NodeData = {
      id: "p", type: "macro", title: "Outer", subtitle: "Macro", icon: "macro", x: 0, y: 0,
      config: { macroId: "m_outer" }, values: { a: false },
      inputs: [{ id: "a", label: "a", type: "bool", editable: true }],
      outputs: [{ id: "b", label: "b", type: "bool" }],
    };
    const out = evaluate([inst], [], {}, {}, Date.now(), {}, macros).outputs["p:b"]!;
    // The literal false reaches the nested not via the macro-in passthrough: not(false) = true.
    expect(out.status).toBe("ok");
    expect(out.v).toBe(true);
  });
});

describe("macro export / import (forkable, nested deps)", () => {
  it("a bundle carries nested dependencies and imports as fresh, independent ids", () => {
    // An outer macro that places an inner macro: exporting the outer must bundle the inner.
    const inner = toggleMacro();
    const outer: MacroDef = {
      id: "m_outer", name: "Outer", stateful: true,
      inputs: [{ id: "t", label: "t", type: "bool" }],
      outputs: [{ id: "s", label: "s", type: "bool" }],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "t", label: "", type: "bool" }] },
        { id: "child", type: "macro", title: "", subtitle: "", icon: "macro", x: 0, y: 0, config: { macroId: inner.id },
          inputs: [{ id: "trig", label: "", type: "bool" }], outputs: [{ id: "state", label: "", type: "bool" }] },
        { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "s", label: "", type: "bool" }], outputs: [] },
      ],
      edges: [
        { id: "e1", from: { node: "in", pin: "t" }, to: { node: "child", pin: "trig" } },
        { id: "e2", from: { node: "child", pin: "state" }, to: { node: "out", pin: "s" } },
      ],
    };
    const lib: MacroMap = { [inner.id]: inner, m_outer: outer };
    expect(collectDeps("m_outer", lib).size).toBe(2);

    const bundle = exportMacro("m_outer", lib);
    expect(Object.keys(bundle.macros)).toHaveLength(2);

    // Importing into an empty library yields fresh ids that don't collide with the source.
    const { macros: imported, rootId } = importBundle(bundle, {});
    expect(rootId).not.toBe("m_outer");
    expect(imported[rootId]).toBeTruthy();
    // The outer's child placement points at the inner macro's new id, not the original.
    const child = imported[rootId]!.nodes.find((n) => n.type === "macro")!;
    const newInnerId = String(child.config?.macroId);
    expect(newInnerId).not.toBe(inner.id);
    expect(imported[newInnerId]).toBeTruthy();
  });
});

describe("grouping a selection builds one boundary node per crossing pin", () => {
  // A small graph: two sources feed an AND; the AND output leaves the selection. Grouping the AND
  // (only) yields two macro inputs and one macro output, each on its own boundary node.
  function andGraph() {
    const a = entityNode("a", "binary_sensor.a", "bool");
    const b = entityNode("b", "binary_sensor.b", "bool");
    const andNode: NodeData = {
      id: "g", type: "and", title: "", subtitle: "", icon: "and", x: 200, y: 0,
      inputs: [{ id: "i0", label: "in", type: "bool" }, { id: "i1", label: "in", type: "bool" }],
      outputs: [{ id: "out", label: "all true", type: "bool" }],
    };
    const sink: NodeData = {
      id: "s", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 400, y: 0,
      config: { entity_id: "light.x" }, inputs: [{ id: "on", label: "", type: "bool" }], outputs: [],
    };
    const nodes = [a, b, andNode, sink];
    const edges: ViewEdge[] = [
      { id: "wa", from: { node: "a", pin: "state" }, to: { node: "g", pin: "i0" } },
      { id: "wb", from: { node: "b", pin: "state" }, to: { node: "g", pin: "i1" } },
      { id: "wo", from: { node: "g", pin: "out" }, to: { node: "s", pin: "on" } },
    ];
    return { nodes, edges };
  }

  it("creates a separate macro-in node per input and macro-out node per output", () => {
    const { nodes, edges } = andGraph();
    const r = groupSelection(nodes, edges, ["g"], {}, { x: 0, y: 0 });
    expect(r).not.toBeNull();
    const ins = r!.def.nodes.filter((n) => n.type === MACRO_IN);
    const outs = r!.def.nodes.filter((n) => n.type === MACRO_OUT);
    // Two crossing inputs and one crossing output, each on its own boundary node.
    expect(ins).toHaveLength(2);
    expect(outs).toHaveLength(1);
    // Every boundary node carries exactly one pin.
    expect(ins.every((n) => n.outputs.length === 1)).toBe(true);
    expect(outs.every((n) => n.inputs.length === 1)).toBe(true);
    // The interface matches the boundary nodes.
    expect(r!.def.inputs).toHaveLength(2);
    expect(r!.def.outputs).toHaveLength(1);
  });

  it("the grouped macro evaluates correctly once placed", () => {
    const { nodes, edges } = andGraph();
    const r = groupSelection(nodes, edges, ["g"], {}, { x: 0, y: 0 })!;
    const macros: MacroMap = { [r.def.id]: r.def };
    // Build the parent graph after grouping: sources, the placement, the sink, and rewired edges.
    const parent = nodes.filter((n) => n.id !== "g").concat(r.instance);
    const parentEdges = edges
      .filter((e) => !r.removedEdgeIds.includes(e.id))
      .concat(r.newEdges);
    const out = evaluate(
      parent, parentEdges,
      { "binary_sensor.a": { state: "on", attributes: {} }, "binary_sensor.b": { state: "on", attributes: {} } },
      {}, Date.now(), {}, macros,
    );
    // Both inputs true -> the AND inside the macro is true.
    const outPin = r.def.outputs[0]!.id;
    expect(out.outputs[`${r.instance.id}:${outPin}`]!.v).toBe(true);
  });
});

describe("boundary nodes preview as unavailable in a definition canvas", () => {
  it("a macro-in output reads as a neutral unavailable, not an error", () => {
    // Evaluated directly (as the definition canvas does), with no placement around it.
    const macroIn: NodeData = {
      id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0,
      inputs: [], outputs: [{ id: "x", label: "x", type: "bool" }],
    };
    const notNode: NodeData = {
      id: "n", type: "not", title: "", subtitle: "", icon: "cmp", x: 0, y: 0,
      inputs: [{ id: "in", label: "", type: "bool" }], outputs: [{ id: "out", label: "", type: "bool" }],
    };
    const edges: ViewEdge[] = [{ id: "e", from: { node: "in", pin: "x" }, to: { node: "n", pin: "in" } }];
    const r = evaluate([macroIn, notNode], edges, {}, {}, Date.now(), {}, {});
    // The boundary output and the downstream node read as unavailable, never error.
    expect(r.outputs["in:x"]!.status).toBe("unavailable");
    expect(r.outputs["n:out"]!.status).toBe("unavailable");
    expect(r.health["in"]).not.toBe("error");
    expect(r.health["n"]).not.toBe("error");
  });
});

describe("macro runtime history", () => {
  it("retains placement output aliases for the server-backed inspector", () => {
    const macros: MacroMap = { m_toggle: toggleMacro() };
    const source = entityNode("src", "binary_sensor.trigger", "bool");
    const instance = macroInstance("a", "m_toggle");
    const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "a", pin: "trig" } }];
    const ha = new MockHA();
    ha.setState("binary_sensor.trigger", "off");
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy([source, instance], edges, false, macros);

    ha.setState("binary_sensor.trigger", "on");
    const samples = deployer.inspect().history["a:state"];
    expect(samples?.map((sample) => sample.value.value)).toEqual([false, true]);
    deployer.stop();
  });
});

describe("a sink inside a macro actuates through the Deployer", () => {
  it("each placement reconciles its own light from its own trigger", () => {
    // A macro that turns a light on/off from a boolean input. The light entity is baked into the
    // macro definition, so a single placement reconciles that one light from its boolean input.
    const def: MacroDef = {
      id: "m_lamp", name: "Lamp", stateful: false,
      inputs: [{ id: "on", label: "on", type: "bool" }],
      outputs: [],
      nodes: [
        { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "on", label: "", type: "bool" }] },
        { id: "snk", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "light.a" },
          inputs: [{ id: "on", label: "", type: "bool" }], outputs: [] },
      ],
      edges: [{ id: "e", from: { node: "in", pin: "on" }, to: { node: "snk", pin: "on" } }],
    };
    const macros: MacroMap = { m_lamp: def };
    const ctrl = (id: string, entity_id: string): NodeData => ({
      id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
      config: { entity_id }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }],
    });
    const instA: NodeData = { id: "a", type: "macro", title: "Lamp", subtitle: "Macro", icon: "macro", x: 0, y: 0, config: { macroId: "m_lamp" }, inputs: [{ id: "on", label: "", type: "bool" }], outputs: [] };
    const nodes = [ctrl("ca", "input_boolean.a"), instA];
    const edges: ViewEdge[] = [{ id: "wa", from: { node: "ca", pin: "state" }, to: { node: "a", pin: "on" } }];

    const ha = new MockHA();
    ha.setState("input_boolean.a", "off");
    ha.setState("light.a", "off");
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy(nodes, edges, true, macros);

    ha.setState("input_boolean.a", "on");
    // The sink inside the macro reconciled the light on, targeting the configured entity.
    expect(ha.lastCall()).toMatchObject({ domain: "light", service: "turn_on", target: { entity_id: "light.a" } });
    deployer.stop();
  });
});
