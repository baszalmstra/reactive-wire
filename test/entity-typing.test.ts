import { describe, it, expect } from "vitest";
import { evaluate, type Memory } from "../shared/engine/evaluate.js";
import { entityStateType } from "../shared/value.js";
import type { NodeData } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";

// An entity node's state pin is typed from the entity's metadata (device_class, unit, domain) so
// the type stays fixed even when the state is unavailable, falling back to sniffing the current
// value only when no class or unit is present.

function entityNode(entity_id: string): NodeData {
  return {
    id: "ent", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id },
    inputs: [],
    outputs: [{ id: "state", label: "", type: "str" }],
  };
}

// The state pin's resolved value for one entity snapshot.
function stateValue(entity_id: string, entities: EntityMap) {
  const r = evaluate([entityNode(entity_id)], [], entities, {} as Memory, 1000);
  return r.outputs["ent:state"]!;
}

describe("entityStateType — metadata-driven typing", () => {
  it("types a temperature sensor as a number", () => {
    expect(entityStateType("sensor.kitchen_temp", "21.5", { device_class: "temperature", unit_of_measurement: "°C" })).toBe("num");
  });
  it("types a timestamp sensor as datetime", () => {
    expect(entityStateType("sensor.last_boot", "2026-06-15T12:00:00Z", { device_class: "timestamp" })).toBe("datetime");
  });
  it("types a duration sensor as Duration", () => {
    expect(entityStateType("sensor.uptime", "5", { device_class: "duration", unit_of_measurement: "min" })).toBe("duration");
  });
  it("types a binary_sensor as bool", () => {
    expect(entityStateType("binary_sensor.room", "on", { device_class: "motion" })).toBe("bool");
  });
  it("types an enum sensor as string", () => {
    expect(entityStateType("sensor.washer", "running", { device_class: "enum" })).toBe("str");
  });
  it("types a unit-only sensor (no device_class) as a number", () => {
    expect(entityStateType("sensor.power", "120", { unit_of_measurement: "W" })).toBe("num");
  });
});

describe("entityStateType — value-sniff fallback when no class or unit", () => {
  it("sniffs a numeric state as a number", () => {
    expect(entityStateType("sensor.raw", "42", {})).toBe("num");
  });
  it("sniffs an on/off state as bool", () => {
    expect(entityStateType("switch.lamp", "off", {})).toBe("bool");
  });
  it("sniffs a hex-string state as color", () => {
    expect(entityStateType("sensor.led", "#ff0088", {})).toBe("color");
  });
  it("does not type a color light's state pin from its rgb_color attribute", () => {
    // The state pin's value is the state ("on"/"off"), not the rgb_color attribute, so a lit
    // color light reads as a usable on/off bool — the color belongs to a separate attribute pin.
    expect(entityStateType("light.lr", "on", { rgb_color: [255, 0, 0] })).toBe("bool");
  });
  it("falls back to string for free text", () => {
    expect(entityStateType("sensor.note", "hello", {})).toBe("str");
  });
});

describe("entity node state pin — type is stable while unavailable", () => {
  it("a temperature sensor types as number even while unavailable", () => {
    const v = stateValue("sensor.kitchen_temp", {
      "sensor.kitchen_temp": { state: "unavailable", attributes: { device_class: "temperature", unit_of_measurement: "°C" } },
    });
    expect(v.type).toBe("num");
    expect(v.status).toBe("unavailable");
  });

  it("a temperature sensor types as number even when the entity is missing entirely", () => {
    // No snapshot for the entity at all: the engine still cannot know the unit, so this degrades
    // to a class-less unavailable string. With a snapshot present (even unavailable) the type holds.
    const v = stateValue("sensor.kitchen_temp", {});
    expect(v.status).toBe("unavailable");
  });

  it("a timestamp sensor types as datetime", () => {
    const v = stateValue("sensor.last_boot", {
      "sensor.last_boot": { state: "2026-06-15T12:00:00Z", attributes: { device_class: "timestamp" } },
    });
    expect(v.type).toBe("datetime");
    expect(v).toEqual({ type: "datetime", v: Date.parse("2026-06-15T12:00:00Z"), status: "ok" });
  });

  it("a duration sensor types as Duration and converts its unit to seconds", () => {
    const v = stateValue("sensor.uptime", {
      "sensor.uptime": { state: "5", attributes: { device_class: "duration", unit_of_measurement: "min" } },
    });
    expect(v).toEqual({ type: "duration", v: 300, status: "ok" });
  });

  it("a duration sensor stays Duration-typed while unavailable", () => {
    const v = stateValue("sensor.uptime", {
      "sensor.uptime": { state: "unknown", attributes: { device_class: "duration", unit_of_measurement: "h" } },
    });
    expect(v.type).toBe("duration");
    expect(v.status).toBe("unavailable");
  });

  it("a binary_sensor types as bool", () => {
    const v = stateValue("binary_sensor.room", {
      "binary_sensor.room": { state: "on", attributes: { device_class: "motion" } },
    });
    expect(v).toEqual({ type: "bool", v: true, status: "ok" });
  });

  it("a lit color light's state pin resolves to a usable on/off bool, not an unavailable color", () => {
    const v = stateValue("light.lr", {
      "light.lr": { state: "on", attributes: { rgb_color: [255, 0, 0] } },
    });
    expect(v).toEqual({ type: "bool", v: true, status: "ok" });
  });

  it("an attribute-less sensor falls back to the value-sniff", () => {
    const numeric = stateValue("sensor.raw", { "sensor.raw": { state: "42", attributes: {} } });
    expect(numeric).toEqual({ type: "num", v: 42, status: "ok" });

    const text = stateValue("sensor.note", { "sensor.note": { state: "hello", attributes: {} } });
    expect(text).toEqual({ type: "str", v: "hello", status: "ok" });
  });
});
