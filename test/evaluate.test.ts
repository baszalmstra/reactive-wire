import { describe, it, expect } from "vitest";
import { evaluate, sinkCalls, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";

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
