import { UN, parseEntityValue } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const hold: NodeDef<"hold"> = {
  type: "hold",
  description: "Latches the value present each time the trigger rises and holds it until the next.",
  template: {
    type: "hold", category: "Stateful", label: "Hold", icon: "mem",
    make: (id) => base(id, {
      type: "hold", title: "Hold", subtitle: "Stateful · latch on edge", icon: "mem", w: 208,
      stateful: true, config: { persistence: "seed-at-boot", initial: null },
      inputs: [
        { id: "value", label: "value", type: "any" },
        { id: "in", label: "trigger", type: "bool" },
      ],
      outputs: [{ id: "out", label: "held", type: "any" }],
    }),
  },
  eval: ({ cfg, inVal, previousMemory }) => {
    const trig = inVal("in");
    const val = inVal("value");
    const t = val?.type ?? "any";
    const m = { ...previousMemory };
    if (m.held === undefined) {
      m.held = parseEntityValue(cfg.initial, t);
      m.prev = false;
      m.seeded = true;
    }
    // Latch the current value input on the rising edge of the trigger. A non-ok value is
    // not latched, so a momentarily offline source keeps the last good held value.
    if (trig && trig.status === "ok") {
      if (trig.v === true && m.prev === false && val && val.status === "ok") m.held = val;
      m.prev = trig.v === true;
    }
    return { outputs: { out: m.held ?? UN(t) }, nextMemory: m };
  },
};
