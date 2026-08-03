import { describe, expect, it } from "vitest";
import { evaluate, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import { latch } from "../shared/engine/nodes/latch.js";
import { paletteDefs } from "../shared/engine/nodes/index.js";
import type { NodeData } from "../shared/node-types.js";

function entityNode(id: string, entityId: string): NodeData {
  return {
    id,
    type: "entity",
    title: "",
    subtitle: "",
    icon: "bulb",
    x: 0,
    y: 0,
    config: { entity_id: entityId },
    inputs: [],
    outputs: [{ id: "state", label: "", type: "bool" }],
  };
}

const setSource = entityNode("set-source", "binary_sensor.set");
const resetSource = entityNode("reset-source", "binary_sensor.reset");
const latchNode = latch.template.make("latch");
const edges: ViewEdge[] = [
  { id: "set-wire", from: { node: "set-source", pin: "state" }, to: { node: "latch", pin: "set" } },
  { id: "reset-wire", from: { node: "reset-source", pin: "state" }, to: { node: "latch", pin: "reset" } },
];

function step(memory: Memory, set: string, reset: string, node: NodeData = latchNode): boolean {
  const result = evaluate([setSource, resetSource, node], edges, {
    "binary_sensor.set": { state: set, attributes: {} },
    "binary_sensor.reset": { state: reset, attributes: {} },
  }, memory).outputs["latch:state"]!;
  expect(result.status).toBe("ok");
  return result.v as boolean;
}

describe("Latch node", () => {
  it("is palette-visible with set and reset boolean inputs", () => {
    expect(paletteDefs).toContain(latch);
    expect(latchNode).toMatchObject({
      stateful: true,
      config: { initial: false, priority: "reset", persistence: "seed-at-boot" },
      inputs: [
        { id: "set", type: "bool" },
        { id: "reset", type: "bool" },
      ],
      outputs: [{ id: "state", type: "bool" }],
    });
  });

  it("sets high and holds until reset is high", () => {
    const memory: Memory = {};
    expect(step(memory, "off", "off")).toBe(false);
    expect(step(memory, "on", "off")).toBe(true);
    expect(step(memory, "off", "off")).toBe(true);
    expect(step(memory, "off", "on")).toBe(false);
    expect(step(memory, "off", "off")).toBe(false);
  });

  it("gives reset priority by default when both inputs are high", () => {
    const memory: Memory = {};
    expect(step(memory, "on", "off")).toBe(true);
    expect(step(memory, "on", "on")).toBe(false);
    expect(step(memory, "on", "off")).toBe(true);
  });

  it("can give set priority when both inputs are high", () => {
    const node = latch.template.make("latch");
    node.config.priority = "set";
    const memory: Memory = {};
    expect(step(memory, "on", "on", node)).toBe(true);
    expect(step(memory, "off", "on", node)).toBe(false);
    expect(step(memory, "on", "on", node)).toBe(true);
  });

  it("ignores unavailable controls without losing the held state", () => {
    const memory: Memory = {};
    expect(step(memory, "on", "off")).toBe(true);
    expect(step(memory, "unavailable", "unavailable")).toBe(true);
    expect(step(memory, "off", "on")).toBe(false);
    expect(step(memory, "unavailable", "unavailable")).toBe(false);
  });
});
