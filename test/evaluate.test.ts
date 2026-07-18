import { describe, it, expect } from "vitest";
import { evaluate, sinkCalls, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";
import { pinKey } from "../shared/identity.js";
import { V } from "../shared/value.js";
import type { NodeDef } from "../shared/engine/node-def.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";

// The canonical graph: sun down AND present -> light red, else off.
const nodes: NodeData[] = [
  { id: "sun", type: "entity", title: "sun", subtitle: "", icon: "sun", x: 0, y: 0, config: { entity_id: "sun.sun" }, inputs: [], outputs: [{ id: "elevation", label: "elevation", type: "num" }] },
  { id: "cmp", type: "compare", title: "", subtitle: "", icon: "cmp", x: 0, y: 0, config: { op: "<" }, typeGroup: ["a", "b"], values: { b: 0 }, inputs: [{ id: "a", label: "", type: "any", editable: true }, { id: "b", label: "", type: "any", editable: true }], outputs: [{ id: "result", label: "", type: "bool" }] },
  { id: "presence", type: "entity", title: "", subtitle: "", icon: "motion", x: 0, y: 0, config: { entity_id: "binary_sensor.room" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }] },
  { id: "and", type: "and", title: "", subtitle: "", icon: "and", x: 0, y: 0, inputs: [{ id: "i0", label: "", type: "bool" }, { id: "i1", label: "", type: "bool" }], outputs: [{ id: "out", label: "", type: "bool" }] },
  { id: "red", type: "const-color", title: "", subtitle: "", icon: "const", x: 0, y: 0, values: { out: "#ff0000" }, inputs: [], outputs: [{ id: "out", label: "", type: "color", editable: true }] },
  { id: "light", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "light.lr" }, widget: "sink", inputs: [{ id: "on", label: "", type: "bool" }, { id: "color", label: "", type: "color" }], outputs: [] },
];
const edges: ViewEdge[] = [
  { id: "e1", from: { node: "sun", pin: "elevation" }, to: { node: "cmp", pin: "a" } },
  { id: "e2", from: { node: "cmp", pin: "result" }, to: { node: "and", pin: "i0" } },
  { id: "e3", from: { node: "presence", pin: "state" }, to: { node: "and", pin: "i1" } },
  { id: "e4", from: { node: "and", pin: "out" }, to: { node: "light", pin: "on" } },
  { id: "e5", from: { node: "red", pin: "out" }, to: { node: "light", pin: "color" } },
];

const calls = (entities: EntityMap) => sinkCalls(nodes, evaluate(nodes, edges, entities, {} as Memory));
const down = { state: "below_horizon", attributes: { elevation: -5 } };
const up = { state: "above_horizon", attributes: { elevation: 5 } };

describe("evaluate (single engine) — canonical example", () => {
  it("stores reserved direct-engine node ids without mutating Object.prototype", () => {
    const memory: Memory = {};
    const directNodes: NodeData[] = [
      { id: "source", type: "const-bool", title: "", subtitle: "", icon: "const", x: 0, y: 0, values: { out: true }, inputs: [], outputs: [{ id: "out", label: "", type: "bool" }] },
      { id: "__proto__", type: "edge", title: "", subtitle: "", icon: "mem", x: 0, y: 0, inputs: [{ id: "in", label: "", type: "any" }], outputs: [{ id: "out", label: "", type: "bool" }] },
    ];
    const directEdges: ViewEdge[] = [
      { id: "e", from: { node: "source", pin: "out" }, to: { node: "__proto__", pin: "in" } },
    ];

    evaluate(directNodes, directEdges, {}, memory, 0);

    expect(Object.hasOwn(memory, "__proto__")).toBe(true);
    expect((Object.prototype as { seeded?: boolean }).seeded).toBeUndefined();
    expect((Object.prototype as { prevVal?: unknown }).prevVal).toBeUndefined();
  });

  it("keeps delimiter-containing node and pin identities distinct", () => {
    const directNodes: NodeData[] = [
      { id: "a:b", type: "const-number", title: "", subtitle: "", icon: "const", x: 0, y: 0, values: { c: 1 }, inputs: [], outputs: [{ id: "c", label: "", type: "num" }] },
      { id: "a", type: "const-number", title: "", subtitle: "", icon: "const", x: 0, y: 0, values: { "b:c": 2 }, inputs: [], outputs: [{ id: "b:c", label: "", type: "num" }] },
    ];

    const result = evaluate(directNodes, [], {}, {});

    expect(pinKey("a:b", "c")).toBe("a%3Ab:c");
    expect(pinKey("a", "b:c")).toBe("a:b%3Ac");
    expect(pinKey("light", "on")).toBe("light:on");
    expect(result.outputs[pinKey("a:b", "c")]?.v).toBe(1);
    expect(result.outputs[pinKey("a", "b:c")]?.v).toBe(2);
  });

  it("turns the light red when the sun is down and someone is present", () => {
    const c = calls({ "sun.sun": down, "binary_sensor.room": { state: "on", attributes: {} } });
    expect(c).toHaveLength(1);
    expect(c[0]!.call).toEqual({ domain: "light", service: "turn_on", data: { rgb_color: [255, 0, 0] }, target: { entity_id: "light.lr" } });
  });

  it("turns the light off when the sun is up", () => {
    const c = calls({ "sun.sun": up, "binary_sensor.room": { state: "on", attributes: {} } });
    expect(c[0]!.call.service).toBe("turn_off");
  });

  it("does not actuate when presence is unavailable (Kleene: undetermined)", () => {
    // sun is down (true) AND presence missing -> unavailable -> sink holds.
    expect(calls({ "sun.sun": down })).toHaveLength(0);
  });

  it("still turns off when the sun is up even if presence is unavailable (Kleene: determined false)", () => {
    const c = calls({ "sun.sun": up });
    expect(c[0]!.call.service).toBe("turn_off");
  });
});

describe("atomic node transactions", () => {
  const atomicNode = (id: string, type: string, outputs = ["first", "second"]): NodeData => ({
    id, type, title: type, subtitle: "", icon: "const", x: 0, y: 0, inputs: [],
    outputs: outputs.map((pin) => ({ id: pin, label: pin, type: "num" as const })),
  });

  function install(def: NodeDef): () => void {
    const previous = REGISTRY[def.type];
    REGISTRY[def.type] = def;
    return () => {
      if (previous) REGISTRY[def.type] = previous;
      else delete REGISTRY[def.type];
    };
  }

  it("evaluates a multi-output stateful node once and commits one coherent memory proposal", () => {
    let count = 0;
    const node = atomicNode("atomic", "test-atomic");
    const restore = install({
      type: "test-atomic",
      description: "test",
      template: { type: "test-atomic", category: "", label: "", icon: "const", make: () => node },
      eval: ({ previousMemory }) => {
        count += 1;
        const generation = Number(previousMemory.state ?? 0) + 1;
        return {
          outputs: { first: V("num", generation), second: V("num", generation) },
          nextMemory: { state: generation },
        };
      },
    });
    try {
      const memory: Memory = {};
      const result = evaluate([{ ...node, outputs: [...node.outputs].reverse() }], [], {}, memory, 0);
      expect(count).toBe(1);
      expect(result.outputs[pinKey("atomic", "first")]?.v).toBe(1);
      expect(result.outputs[pinKey("atomic", "second")]?.v).toBe(1);
      expect(memory.atomic?.state).toBe(1);
    } finally {
      restore();
    }
  });

  it("rolls back all proposed memory when a later node definition fails", () => {
    const first = atomicNode("first", "test-proposal", ["out"]);
    const broken = atomicNode("broken", "test-broken", ["out"]);
    const restoreFirst = install({
      type: "test-proposal", description: "test",
      template: { type: "test-proposal", category: "", label: "", icon: "const", make: () => first },
      eval: () => ({ outputs: { out: V("num", 2) }, nextMemory: { state: 2 } }),
    });
    const restoreBroken = install({
      type: "test-broken", description: "test",
      template: { type: "test-broken", category: "", label: "", icon: "const", make: () => broken },
      eval: () => ({ outputs: {} }),
    });
    try {
      const memory: Memory = { first: { state: 1 } };
      expect(() => evaluate([first, broken], [], {}, memory, 0)).toThrow('omitted declared output "out"');
      expect(memory).toEqual({ first: { state: 1 } });
    } finally {
      restoreBroken();
      restoreFirst();
    }
  });

  it("advances transient sink memory once per transaction", () => {
    let count = 0;
    const sink = { ...atomicNode("sink", "test-transient", []), inputs: [], config: { entity_id: "switch.test" } };
    const restore = install({
      type: "test-transient", description: "test", transient: true,
      template: { type: "test-transient", category: "", label: "", icon: "const", make: () => sink },
      eval: () => ({ outputs: {} }),
      evalSink: ({ previousMemory }) => {
        count += 1;
        return { call: null, nextMemory: { state: Number(previousMemory.state ?? 0) + 1 } };
      },
    });
    try {
      const memory: Memory = {};
      evaluate([sink], [], {}, memory, 0);
      expect(count).toBe(1);
      expect(memory.sink?.state).toBe(1);
    } finally {
      restore();
    }
  });
});
