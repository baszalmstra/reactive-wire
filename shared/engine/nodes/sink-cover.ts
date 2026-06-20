import { UN } from "../../value.js";
import type { NodeDef } from "../node-def.js";
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
  eval: () => UN("any"),
  /**
   * A reconciling cover call: drives the cover to a desired position, or fully open/closed from a
   * boolean. Acts only when the desired position differs from the cover's current position, so a
   * cover already where it should be is left alone.
   */
  evalSink: ({ cfg, okInput, entities }) => {
    const entity_id = String(cfg.entity_id ?? "");
    const e = entities[entity_id];
    const position = okInput("position");
    if (position) {
      const want = Number(position.v);
      const actual = e ? Number(e.attributes.current_position) : undefined;
      if (actual !== want) {
        return { domain: "cover", service: "set_cover_position", data: { position: want }, target: { entity_id } };
      }
      return null;
    }
    const open = okInput("open");
    if (open) {
      const want = open.v === true;
      const actual = e ? String(e.state) : undefined;
      if (want && actual !== "open") return { domain: "cover", service: "open_cover", data: {}, target: { entity_id } };
      if (!want && actual !== "closed") return { domain: "cover", service: "close_cover", data: {}, target: { entity_id } };
    }
    return null;
  },
};
