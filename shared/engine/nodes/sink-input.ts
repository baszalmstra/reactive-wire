import { UN } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const sinkInput: NodeDef = {
  type: "sink-input",
  description: "Drives an input helper to the desired value, acting only on a change.",
  sinkGatePin: "value",
  template: {
    type: "sink-input", category: "Sinks", label: "Input helper", icon: "const",
    requires: { field: "entity_id", kind: "entity", label: "Helper entity", domains: ["input_boolean", "input_number", "input_select", "input_text"] },
    make: (id) => base(id, {
      type: "sink-input", title: "helper", subtitle: "input_* · reconciling sink", icon: "const", w: 232,
      bodyExtra: 56, widget: "sink",
      config: { entity_id: "" },
      inputs: [{ id: "value", label: "value", type: "any", editable: true }],
      outputs: [],
    }),
  },
  eval: () => UN("any"),
  /**
   * A reconciling helper (input_boolean / input_number / input_select / input_text) call: set the
   * helper to a desired value, acting only when it differs from the helper's current state. The
   * service is chosen from the entity's domain so one node covers all the input_* helpers.
   */
  evalSink: ({ cfg, okInput, entities }) => {
    const entity_id = String(cfg.entity_id ?? "");
    const value = okInput("value");
    if (!value) return null;
    const domain = entity_id.split(".")[0] ?? "";
    const e = entities[entity_id];
    const actual = e ? String(e.state) : undefined;
    switch (domain) {
      case "input_boolean": {
        const want = value.v === true;
        if (actual !== undefined && (actual === "on") === want) return null;
        return { domain, service: want ? "turn_on" : "turn_off", data: {}, target: { entity_id } };
      }
      case "input_number": {
        const want = Number(value.v);
        if (actual !== undefined && Number(actual) === want) return null;
        return { domain, service: "set_value", data: { value: want }, target: { entity_id } };
      }
      case "input_select": {
        const want = String(value.v);
        if (actual === want) return null;
        return { domain, service: "select_option", data: { option: want }, target: { entity_id } };
      }
      case "input_text":
      default: {
        const want = String(value.v);
        if (actual === want) return null;
        return { domain: domain || "input_text", service: "set_value", data: { value: want }, target: { entity_id } };
      }
    }
  },
};
