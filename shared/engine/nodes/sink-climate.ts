import { reconcileClimate } from "../ha-reconcile.js";
import { noOutputs, statelessSink, type NodeDef } from "../node-def.js";
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
  eval: noOutputs,
  /**
   * A reconciling climate call: only the dimensions whose desired (ok) value differs from the
   * entity's current value are written, so re-asserting the same target is a no-op and a
   * self-write echo doesn't re-fire. A dimension with a non-ok desired value is left untouched.
   */
  evalSink: statelessSink(({ cfg, okInput, entities }) => reconcileClimate(String(cfg.entity_id ?? ""), {
    temperature: okInput("temperature"),
    hvac_mode: okInput("hvac_mode"),
  }, entities)),
};
