import { UN } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const sinkClimate: NodeDef = {
  type: "sink-climate",
  description: "Drives a climate entity to the desired temperature and mode, acting only on a change.",
  template: {
    type: "sink-climate", category: "Sinks", label: "Climate", icon: "const",
    requires: { field: "entity_id", kind: "entity", label: "Climate entity", domains: ["climate"] },
    make: (id) => base(id, {
      type: "sink-climate", title: "climate", subtitle: "Climate · reconciling sink", icon: "const", w: 248,
      bodyExtra: 56, widget: "sink",
      config: { entity_id: "" },
      inputs: [
        { id: "temperature", label: "temperature", type: "num", editable: true },
        { id: "hvac_mode", label: "mode", type: "str", editable: true },
      ],
      outputs: [],
    }),
  },
  eval: () => UN("any"),
  /**
   * A reconciling climate call: only the dimensions whose desired (ok) value differs from the
   * entity's current value are written, so re-asserting the same target is a no-op and a
   * self-write echo doesn't re-fire. A dimension with a non-ok desired value is left untouched.
   */
  evalSink: ({ cfg, okInput, entities }) => {
    const entity_id = String(cfg.entity_id ?? "");
    const e = entities[entity_id];
    const temp = okInput("temperature");
    const mode = okInput("hvac_mode");
    // Mode is its own service; prefer it when it differs so an off→heat transition lands first.
    if (mode) {
      const actual = e ? String(e.state) : undefined;
      if (actual !== String(mode.v)) {
        return { domain: "climate", service: "set_hvac_mode", data: { hvac_mode: mode.v }, target: { entity_id } };
      }
    }
    if (temp) {
      const actual = e ? Number(e.attributes.temperature) : undefined;
      if (actual !== Number(temp.v)) {
        return { domain: "climate", service: "set_temperature", data: { temperature: temp.v }, target: { entity_id } };
      }
    }
    return null;
  },
};
