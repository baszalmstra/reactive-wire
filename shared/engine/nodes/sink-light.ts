import { UN, hexToRgb } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

function rgbMatches(actual: unknown, want: [number, number, number]): boolean {
  return Array.isArray(actual) && actual.length >= 3 && want.every((v, i) => Number(actual[i]) === v);
}

function brightnessMatches(actual: unknown, want: unknown): boolean {
  return Number(actual) === Number(want);
}

export const sinkLight: NodeDef = {
  type: "sink-light",
  description: "Drives a light to the desired on/color/brightness, acting only on a change.",
  sinkGatePin: "on",
  template: {
    type: "sink-light", category: "Sinks", label: "Light", icon: "bulb",
    requires: { field: "entity_id", kind: "entity", label: "Light entity", domains: ["light"] },
    make: (id) => base(id, {
      type: "sink-light", title: "light", subtitle: "Light · reconciling sink", icon: "bulb", w: 248,
      bodyExtra: 56, widget: "sink", config: { entity_id: "" },
      values: { on: false },
      inputs: [
        { id: "on", label: "on", type: "bool", editable: true },
        { id: "color", label: "color", type: "color", editable: true },
        { id: "brightness", label: "brightness", type: "num", editable: true },
      ],
      outputs: [],
    }),
  },
  eval: () => UN("any"),
  // A reconciling light call: compare the desired on/color/brightness against the entity's
  // current state and only write when at least one requested dimension differs. If the entity is
  // missing (or a requested attribute is absent), emit the desired call rather than assuming the
  // world already matches.
  evalSink: ({ cfg, okInput, entities }) => {
    const entity_id = String(cfg.entity_id ?? "");
    const on = okInput("on");
    if (!on) return null;

    const e = entities[entity_id];
    const actualState = e ? String(e.state) : undefined;
    if (on.v === false) {
      if (actualState === "off") return null;
      return { domain: "light", service: "turn_off", data: {}, target: { entity_id } };
    }

    const data: Record<string, unknown> = {};
    let differs = actualState !== "on";
    const color = okInput("color");
    if (color) {
      const want = hexToRgb(String(color.v));
      data.rgb_color = want;
      if (!e || !rgbMatches(e.attributes.rgb_color, want)) differs = true;
    }
    const brightness = okInput("brightness");
    if (brightness) {
      data.brightness = brightness.v;
      if (!e || !brightnessMatches(e.attributes.brightness, brightness.v)) differs = true;
    }
    if (!differs) return null;
    return { domain: "light", service: "turn_on", data, target: { entity_id } };
  },
};
