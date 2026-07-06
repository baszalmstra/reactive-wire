import { describe, expect, it } from "vitest";
import { evaluate, sinkCalls, type Memory } from "../shared/engine/evaluate.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";
import type { EntityMap } from "../shared/entities.js";
import type { NodeData } from "../shared/node-types.js";

const entities: EntityMap = {
  "light.lr": { state: "on", attributes: { rgb_color: [255, 255, 255], brightness: 200 } },
  "switch.plug": { state: "on", attributes: {} },
};

function withConfig(node: NodeData, config: Record<string, unknown>): NodeData {
  return { ...node, config: { ...node.config, ...config } };
}

describe("node template defaults", () => {
  it("defaults color constants to neutral white for Home Assistant lights", () => {
    const color = REGISTRY["const-color"]!.template.make("color");

    expect(color.values?.out).toBe("#ffffff");

    const results = evaluate([color], [], {}, {} as Memory);
    expect(results.outputs["color:out"]).toMatchObject({ status: "ok", type: "color", v: "#ffffff" });
  });

  it("offers a Duration constant with a count and unit literal", () => {
    const duration = REGISTRY["const-duration"]!.template.make("duration");

    expect(duration.values?.out).toEqual({ count: 5, unit: "min" });

    const results = evaluate([duration], [], {}, {} as Memory);
    expect(results.outputs["duration:out"]).toMatchObject({ status: "ok", type: "duration", v: 300 });
  });

  it("leaves new light sinks inert until an on/off command is wired or explicitly set", () => {
    const light = withConfig(REGISTRY["sink-light"]!.template.make("light"), { entity_id: "light.lr" });

    const results = evaluate([light], [], entities, {} as Memory);

    expect(light.values?.on).toBeUndefined();
    expect(light.values?.color).toBeUndefined();
    expect(light.values?.brightness).toBeUndefined();
    expect(results.inputs["light:on"]).toBeNull();
    expect(sinkCalls([light], results)).toEqual([]);
  });

  it("leaves generic service-call sinks inert until their trigger is wired or explicitly set", () => {
    const service = withConfig(REGISTRY["sink-call"]!.template.make("service"), { entity_id: "switch.plug" });

    const results = evaluate([service], [], entities, {} as Memory);

    expect(service.values?.on).toBeUndefined();
    expect(results.inputs["service:on"]).toBeNull();
    expect(sinkCalls([service], results)).toEqual([]);
  });
});
