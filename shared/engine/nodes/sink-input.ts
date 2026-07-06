import { UN } from "../../value.js";
import { reconcileInputHelper } from "../ha-reconcile.js";
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
  evalSink: ({ cfg, okInput, entities }) => reconcileInputHelper(String(cfg.entity_id ?? ""), {
    value: okInput("value"),
  }, entities),
};
