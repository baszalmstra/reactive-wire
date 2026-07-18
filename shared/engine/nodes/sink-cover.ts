import { reconcileCover } from "../ha-reconcile.js";
import { noOutputs, statelessSink, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const sinkCover: NodeDef = {
  type: "sink-cover",
  description: "Drives a cover to the desired position or open state, acting only on a change.",
  template: {
    type: "sink-cover", category: "Sinks", label: "Cover", icon: "const",
    requires: { field: "entity_id", kind: "entity", label: "Cover entity", domains: ["cover"] },
    make: (id) => base(id, {
      type: "sink-cover", title: "cover", subtitle: "Cover · reconciling sink", icon: "const", w: 248,
      bodyExtra: 56, widget: "sink",
      config: { entity_id: "" },
      inputs: [
        { id: "position", label: "position", type: "num", editable: true },
        { id: "open", label: "open", type: "bool", editable: true },
      ],
      outputs: [],
    }),
  },
  eval: noOutputs,
  /**
   * A reconciling cover call: drives the cover to a desired position, or fully open/closed from a
   * boolean. Acts only when the desired position differs from the cover's current position, so a
   * cover already where it should be is left alone.
   */
  evalSink: statelessSink(({ cfg, okInput, entities }) => reconcileCover(String(cfg.entity_id ?? ""), {
    position: okInput("position"),
    open: okInput("open"),
  }, entities)),
};
