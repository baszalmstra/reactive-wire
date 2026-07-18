import { reconcileLight } from "../ha-reconcile.js";
import { noOutputs, statelessSink, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const sinkLight: NodeDef<"sink-light"> = {
  type: "sink-light",
  description: "Drives a light to the desired on/color/temperature/brightness, acting only on a change. Lights that support transitions gain separate optional, wireable on/off duration inputs.",
  sinkGatePin: "on",
  template: {
    type: "sink-light", category: "Sinks", label: "Light", icon: "bulb",
    requires: { field: "entity_id", kind: "entity", label: "Light entity", domains: ["light"] },
    make: (id) => base(id, {
      type: "sink-light", title: "light", subtitle: "Light · reconciling sink", icon: "bulb", w: 248,
      bodyExtra: 56, widget: "sink", config: { entity_id: "" },
      inputs: [
        { id: "on", label: "on", type: "bool", editable: true },
        { id: "color", label: "color", type: "color", editable: true },
        { id: "brightness", label: "brightness", type: "num", editable: true },
      ],
      outputs: [],
    }),
  },
  eval: noOutputs,
  // A reconciling light call: compare the desired on/color/brightness against the entity's
  // current state and only write when at least one requested dimension differs. If the entity is
  // missing (or a requested attribute is absent), emit the desired call rather than assuming the
  // world already matches.
  evalSink: statelessSink<"sink-light">(({ cfg, okInput, entities }) => reconcileLight(String(cfg.entity_id ?? ""), {
    on: okInput("on"),
    color: okInput("color"),
    temperature: okInput("temperature"),
    brightness: okInput("brightness"),
    transitionOn: okInput("transition_on"),
    transitionOff: okInput("transition_off"),
  }, entities)),
};
