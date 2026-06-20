import { describe, it, expect } from "vitest";
import { evaluate, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
// Tests drive a stateful node's inputs through entity nodes whose state varies between
// successive evaluate() calls (one call per simulated entity change).
function entityNode(id: string, entity_id: string, type: "bool" | "num" | "str"): NodeData {
  return {
    id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id },
    inputs: [], outputs: [{ id: "state", label: "", type }],
  };
}

describe("edge / rising / falling detectors", () => {
  const inNode = entityNode("in", "binary_sensor.x", "bool");
  function graph(nodeType: string): { nodes: NodeData[]; edges: ViewEdge[] } {
    const node: NodeData = {
      id: "d", type: nodeType, title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      config: { persistence: "seed-at-boot" },
      inputs: [{ id: "in", label: "", type: nodeType === "edge" ? "any" : "bool" }],
      outputs: [{ id: "out", label: "", type: "bool" }],
    };
    return {
      nodes: [inNode, node],
      edges: [{ id: "e", from: { node: "in", pin: "state" }, to: { node: "d", pin: "in" } }],
    };
  }
  const step = (g: ReturnType<typeof graph>, mem: Memory, state: string) =>
    evaluate(g.nodes, g.edges, { "binary_sensor.x": { state, attributes: {} } }, mem).outputs["d:out"]!;

  it("rising fires only on false→true", () => {
    const g = graph("rising");
    const mem: Memory = {};
    expect(step(g, mem, "off").v).toBe(false); // first reading: no prior, no edge
    expect(step(g, mem, "off").v).toBe(false); // stays false
    expect(step(g, mem, "on").v).toBe(true);  // rose
    expect(step(g, mem, "on").v).toBe(false); // level-true, no new edge
    expect(step(g, mem, "off").v).toBe(false); // falling, not rising
    expect(step(g, mem, "on").v).toBe(true);  // rose again
  });

  it("falling fires only on true→false", () => {
    const g = graph("falling");
    const mem: Memory = {};
    expect(step(g, mem, "on").v).toBe(false);  // first reading
    expect(step(g, mem, "off").v).toBe(true);  // fell
    expect(step(g, mem, "off").v).toBe(false); // level-false
    expect(step(g, mem, "on").v).toBe(false);  // rising
    expect(step(g, mem, "off").v).toBe(true);  // fell again
  });

  it("edge fires on any change of an ok value", () => {
    const g = graph("edge");
    const mem: Memory = {};
    expect(step(g, mem, "off").v).toBe(false);
    expect(step(g, mem, "on").v).toBe(true);  // changed
    expect(step(g, mem, "off").v).toBe(true); // changed
    expect(step(g, mem, "off").v).toBe(false); // unchanged
  });

  it("a non-ok reading does not fire an edge and does not corrupt the previous value", () => {
    const g = graph("rising");
    const mem: Memory = {};
    expect(step(g, mem, "off").v).toBe(false);
    // entity goes unavailable: input is not ok, prev stays "off"
    expect(step(g, mem, "unavailable").v).toBe(false);
    // back to "on": the remembered prev is still false, so this is a genuine rising edge
    expect(step(g, mem, "on").v).toBe(true);
  });
});

describe("hold (latch a value on a trigger edge)", () => {
  // value source = a number entity; trigger = a bool entity.
  const valNode = entityNode("val", "sensor.v", "num");
  const trigNode = entityNode("trg", "binary_sensor.t", "bool");
  const hold: NodeData = {
    id: "h", type: "hold", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
    config: { persistence: "seed-at-boot", initial: null },
    inputs: [
      { id: "value", label: "", type: "num" },
      { id: "in", label: "", type: "bool" },
    ],
    outputs: [{ id: "out", label: "", type: "any" }],
  };
  const nodes = [valNode, trigNode, hold];
  const edges: ViewEdge[] = [
    { id: "ev", from: { node: "val", pin: "state" }, to: { node: "h", pin: "value" } },
    { id: "et", from: { node: "trg", pin: "state" }, to: { node: "h", pin: "in" } },
  ];
  const step = (mem: Memory, v: string, t: string) =>
    evaluate(nodes, edges, { "sensor.v": { state: v, attributes: {} }, "binary_sensor.t": { state: t, attributes: {} } }, mem).outputs["h:out"]!;

  it("latches the value input on the trigger's rising edge and holds it after", () => {
    const mem: Memory = {};
    expect(step(mem, "1", "off").status).toBe("unavailable"); // nothing latched yet
    let r = step(mem, "5", "on"); // rising edge: latch 5
    expect(r.status).toBe("ok");
    expect(r.v).toBe(5);
    r = step(mem, "9", "on"); // still high, value changes — not relatched
    expect(r.v).toBe(5);
    r = step(mem, "9", "off"); // released
    expect(r.v).toBe(5);
    r = step(mem, "12", "on"); // new rising edge: latch 12
    expect(r.v).toBe(12);
  });

  it("a non-ok trigger never latches", () => {
    const mem: Memory = {};
    expect(step(mem, "7", "unavailable").status).toBe("unavailable");
    // trigger never went ok-true, so nothing was held
    expect(step(mem, "7", "unavailable").status).toBe("unavailable");
  });

  it("a non-ok value on a trigger edge keeps the last good held value", () => {
    const mem: Memory = {};
    let r = step(mem, "5", "on"); // latch 5
    expect(r.v).toBe(5);
    r = step(mem, "5", "off"); // release
    expect(r.v).toBe(5);
    // value goes offline while the trigger edges high again: must not clobber the held 5
    r = step(mem, "unavailable", "on");
    expect(r.status).toBe("ok");
    expect(r.v).toBe(5);
  });

  it("does not latch a non-ok value on the very first trigger edge", () => {
    const mem: Memory = {};
    // value offline, trigger rises: nothing good to latch, output stays unavailable
    const r = step(mem, "unavailable", "on");
    expect(r.status).toBe("unavailable");
  });
});

describe("fold / scan (accumulate on a trigger edge)", () => {
  const valNode = entityNode("val", "sensor.v", "num");
  const trigNode = entityNode("trg", "binary_sensor.t", "bool");
  function foldNode(op: string, initial: number): NodeData {
    return {
      id: "f", type: "fold", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      config: { persistence: "durable", op, initial },
      inputs: [
        { id: "value", label: "", type: "num" },
        { id: "in", label: "", type: "bool" },
      ],
      outputs: [{ id: "out", label: "", type: "num" }],
    };
  }
  const edges: ViewEdge[] = [
    { id: "ev", from: { node: "val", pin: "state" }, to: { node: "f", pin: "value" } },
    { id: "et", from: { node: "trg", pin: "state" }, to: { node: "f", pin: "in" } },
  ];
  const step = (nodes: NodeData[], mem: Memory, v: string, t: string) =>
    evaluate(nodes, edges, { "sensor.v": { state: v, attributes: {} }, "binary_sensor.t": { state: t, attributes: {} } }, mem).outputs["f:out"]!;

  it("sums values on each rising edge, starting from the configured initial", () => {
    const nodes = [valNode, trigNode, foldNode("sum", 10)];
    const mem: Memory = {};
    expect(step(nodes, mem, "3", "off").v).toBe(10); // initial
    expect(step(nodes, mem, "3", "on").v).toBe(13);  // +3
    expect(step(nodes, mem, "3", "on").v).toBe(13);  // level-true, no re-add
    expect(step(nodes, mem, "4", "off").v).toBe(13);
    expect(step(nodes, mem, "4", "on").v).toBe(17);  // +4
  });

  it("count increments per edge regardless of value", () => {
    const nodes = [valNode, trigNode, foldNode("count", 0)];
    const mem: Memory = {};
    expect(step(nodes, mem, "99", "on").v).toBe(1);
    expect(step(nodes, mem, "99", "off").v).toBe(1);
    expect(step(nodes, mem, "99", "on").v).toBe(2);
  });

  it("max keeps the largest value seen on an edge", () => {
    const nodes = [valNode, trigNode, foldNode("max", 0)];
    const mem: Memory = {};
    expect(step(nodes, mem, "5", "on").v).toBe(5);
    expect(step(nodes, mem, "2", "off").v).toBe(5);
    expect(step(nodes, mem, "2", "on").v).toBe(5);  // 2 < 5
    expect(step(nodes, mem, "8", "on").v).toBe(5);  // level-true, ignored
    expect(step(nodes, mem, "8", "off").v).toBe(5);
    expect(step(nodes, mem, "8", "on").v).toBe(8);
  });

  it("min takes the first value rather than the configured initial of 0", () => {
    const nodes = [valNode, trigNode, foldNode("min", 0)];
    const mem: Memory = {};
    expect(step(nodes, mem, "5", "on").v).toBe(5);  // first edge seeds 5, not min(0,5)
    expect(step(nodes, mem, "5", "off").v).toBe(5);
    expect(step(nodes, mem, "3", "on").v).toBe(3);  // min(5,3)
    expect(step(nodes, mem, "3", "off").v).toBe(3);
    expect(step(nodes, mem, "8", "on").v).toBe(3);  // min(3,8)
  });

  it("max takes the first value rather than the configured initial of 0 (negatives)", () => {
    const nodes = [valNode, trigNode, foldNode("max", 0)];
    const mem: Memory = {};
    expect(step(nodes, mem, "-5", "on").v).toBe(-5); // first edge seeds -5, not max(0,-5)
    expect(step(nodes, mem, "-5", "off").v).toBe(-5);
    expect(step(nodes, mem, "-2", "on").v).toBe(-2); // max(-5,-2)
  });

  it("a non-ok value is ignored on an edge (state is not corrupted)", () => {
    const nodes = [valNode, trigNode, foldNode("sum", 0)];
    const mem: Memory = {};
    expect(step(nodes, mem, "5", "on").v).toBe(5);
    // value goes unavailable but trigger edges high again: nothing is added
    expect(step(nodes, mem, "5", "off").v).toBe(5);
    expect(step(nodes, mem, "unavailable", "on").v).toBe(5);
  });

  it("durable memory is preserved when a restored map is passed back in", () => {
    const nodes = [valNode, trigNode, foldNode("sum", 0)];
    const mem: Memory = {};
    step(nodes, mem, "4", "on"); // total 4
    // simulate a restart that restored the persisted slot
    const restored: Memory = { f: { ...mem.f! } };
    expect(step(nodes, restored, "4", "off").v).toBe(4); // not reset to initial
  });
});

describe("state-persistence policy", () => {
  it("reseed-from-world boots a toggle from the entity's actual state", () => {
    const light = entityNode("lt", "light.lr", "bool");
    const toggle: NodeData = {
      id: "tg", type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      stateful: true,
      config: { persistence: "reseed-from-world", entity_id: "light.lr", initial: false },
      inputs: [{ id: "in", label: "", type: "bool" }],
      outputs: [{ id: "state", label: "", type: "bool" }],
    };
    const nodes = [light, toggle];
    const edges: ViewEdge[] = [];
    const mem: Memory = {};
    // light is on at boot -> toggle seeds true despite config.initial=false
    const out = evaluate(nodes, edges, { "light.lr": { state: "on", attributes: {} } }, mem).outputs["tg:state"]!;
    expect(out.v).toBe(true);
  });

  it("reseed-from-world defers seeding until the entity is present, then aligns", () => {
    const light = entityNode("lt", "light.lr", "bool");
    const toggle: NodeData = {
      id: "tg", type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      stateful: true,
      config: { persistence: "reseed-from-world", entity_id: "light.lr", initial: false },
      inputs: [{ id: "in", label: "", type: "bool" }],
      outputs: [{ id: "state", label: "", type: "bool" }],
    };
    const nodes = [light, toggle];
    const edges: ViewEdge[] = [];
    const mem: Memory = {};
    // entity absent at boot -> falls back to config.initial=false, but is not yet locked
    let out = evaluate(nodes, edges, {}, mem).outputs["tg:state"]!;
    expect(out.v).toBe(false);
    // entity now appears on -> reseeds from the world
    out = evaluate(nodes, edges, { "light.lr": { state: "on", attributes: {} } }, mem).outputs["tg:state"]!;
    expect(out.v).toBe(true);
  });

  it("seed-at-boot toggle ignores the world and uses config initial", () => {
    const toggle: NodeData = {
      id: "tg", type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      stateful: true, config: { persistence: "seed-at-boot", initial: true },
      inputs: [{ id: "in", label: "", type: "bool" }],
      outputs: [{ id: "state", label: "", type: "bool" }],
    };
    const out = evaluate([toggle], [], {}, {}).outputs["tg:state"]!;
    expect(out.v).toBe(true);
  });

  it("an unknown persistence value defaults to seed-at-boot", () => {
    const toggle: NodeData = {
      id: "tg", type: "toggle", title: "", subtitle: "", icon: "mem", x: 0, y: 0,
      stateful: true, config: { persistence: "nonsense", initial: false },
      inputs: [{ id: "in", label: "", type: "bool" }],
      outputs: [{ id: "state", label: "", type: "bool" }],
    };
    const out = evaluate([toggle], [], { "light.lr": { state: "on", attributes: {} } }, {}).outputs["tg:state"]!;
    expect(out.v).toBe(false); // did not reseed from any world
  });
});
