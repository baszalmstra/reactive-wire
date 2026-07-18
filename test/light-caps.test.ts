import { describe, it, expect } from "vitest";
import { lightCaps, lightSinkPins, reconcileLightSinkPins, kelvinToHex } from "../shared/engine/light-caps.js";
import { hexToRgb } from "../shared/value.js";
import type { PinDef } from "../shared/node-types.js";

describe("lightCaps", () => {
  it("reads brightness, rgb, and color_temp from supported_color_modes", () => {
    expect(lightCaps({ supported_color_modes: ["color_temp", "rgb"] })).toMatchObject({ brightness: true, rgb: true, colorTemp: true });
    expect(lightCaps({ supported_color_modes: ["color_temp"] })).toMatchObject({ brightness: true, rgb: false, colorTemp: true });
    expect(lightCaps({ supported_color_modes: ["hs"] })).toMatchObject({ brightness: true, rgb: true, colorTemp: false });
  });

  it("treats an onoff-only light as supporting no dimensions", () => {
    expect(lightCaps({ supported_color_modes: ["onoff"] })).toEqual({ brightness: false, rgb: false, colorTemp: false, transition: false });
  });

  it("reads transition support from the Home Assistant feature bit alongside modern color modes", () => {
    expect(lightCaps({ supported_color_modes: ["rgb"], supported_features: 32 }))
      .toMatchObject({ brightness: true, rgb: true, colorTemp: false, transition: true });
    expect(lightCaps({ supported_color_modes: ["rgb"], supported_features: 0 }))
      .toMatchObject({ transition: false });
  });

  it("carries the kelvin bounds when the light reports them", () => {
    expect(lightCaps({ supported_color_modes: ["color_temp"], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 }))
      .toMatchObject({ minKelvin: 2200, maxKelvin: 6500 });
  });

  it("falls back to the legacy supported_features bitmask", () => {
    // brightness (1) + color_temp (2) + color (16) = 19
    expect(lightCaps({ supported_features: 19 })).toMatchObject({ brightness: true, rgb: true, colorTemp: true });
    // brightness only
    expect(lightCaps({ supported_features: 1 })).toMatchObject({ brightness: true, rgb: false, colorTemp: false });
  });

  it("returns null when capabilities are unknown", () => {
    expect(lightCaps({})).toBeNull();
    expect(lightCaps(undefined)).toBeNull();
    expect(lightCaps({ supported_features: 0 })).toBeNull();
  });
});

describe("lightSinkPins", () => {
  const ids = (pins: PinDef[]) => pins.map((p) => p.id);

  it("exposes only the supported dimensions", () => {
    expect(ids(lightSinkPins({ brightness: true, rgb: true, colorTemp: true, transition: true }))).toEqual([
      "on", "color", "temperature", "brightness", "transition_on", "transition_off",
    ]);
    expect(ids(lightSinkPins({ brightness: true, rgb: false, colorTemp: true, transition: false }))).toEqual(["on", "temperature", "brightness"]);
    expect(ids(lightSinkPins({ brightness: false, rgb: false, colorTemp: false, transition: false }))).toEqual(["on"]);
  });

  it("keeps a permissive color + brightness default when capabilities are unknown", () => {
    expect(ids(lightSinkPins(null))).toEqual(["on", "color", "brightness"]);
  });
});

describe("reconcileLightSinkPins", () => {
  const stored: PinDef[] = [
    { id: "on", label: "on", type: "bool", editable: true },
    { id: "color", label: "color", type: "color", editable: true },
    { id: "brightness", label: "brightness", type: "num", editable: true },
  ];

  it("adds newly supported pins and removes unsupported, unwired ones", () => {
    const next = reconcileLightSinkPins(stored, { brightness: true, rgb: false, colorTemp: true, transition: true }, () => false);
    expect(next.map((p) => p.id)).toEqual(["on", "temperature", "brightness", "transition_on", "transition_off"]);
    expect(next.find((p) => p.id === "transition_on")).toMatchObject({ type: "duration", editable: true });
  });

  it("ghosts an unsupported pin that still carries a wire", () => {
    const next = reconcileLightSinkPins(stored, { brightness: true, rgb: false, colorTemp: false, transition: false }, (id) => id === "color");
    const color = next.find((p) => p.id === "color");
    expect(color).toMatchObject({ ghost: true, missing: "color" });
    expect(next.map((p) => p.id)).toEqual(["on", "brightness", "color"]);
  });

  it("returns the stored list by identity when capabilities have not changed", () => {
    const shaped = lightSinkPins({ brightness: true, rgb: true, colorTemp: false, transition: true });
    expect(reconcileLightSinkPins(shaped, { brightness: true, rgb: true, colorTemp: false, transition: true }, () => false)).toBe(shaped);
  });

  it("ghosts wired transition pins when support disappears", () => {
    const withTransitions = lightSinkPins({ brightness: true, rgb: true, colorTemp: false, transition: true });
    const next = reconcileLightSinkPins(
      withTransitions,
      { brightness: true, rgb: true, colorTemp: false, transition: false },
      (id) => id === "transition_on",
    );
    expect(next.find((p) => p.id === "transition_on")).toMatchObject({ ghost: true, missing: "on transition" });
    expect(next.some((p) => p.id === "transition_off")).toBe(false);
    expect(reconcileLightSinkPins(
      next,
      { brightness: true, rgb: true, colorTemp: false, transition: false },
      (id) => id === "transition_on",
    )).toBe(next);
  });

  it("clears a stale ghost when the light supports the pin again", () => {
    const ghosted: PinDef[] = [...stored, { id: "temperature", label: "temperature", type: "num", ghost: true, missing: "temperature" }];
    const next = reconcileLightSinkPins(ghosted, { brightness: true, rgb: true, colorTemp: true, transition: true }, () => true);
    const temp = next.find((p) => p.id === "temperature");
    expect(temp?.ghost).toBeUndefined();
  });
});

describe("kelvinToHex", () => {
  it("renders warm temperatures redder than cool ones", () => {
    const warm = hexToRgb(kelvinToHex(2700));
    const cool = hexToRgb(kelvinToHex(6500));
    // Warm light is red-dominant; cool light carries much more blue.
    expect(warm[0]).toBeGreaterThan(warm[2]);
    expect(cool[2]).toBeGreaterThan(warm[2]);
  });
});
