import { V } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const toggle: NodeDef<"toggle"> = {
  type: "toggle",
  description: "Flips between true and false each time the trigger rises.",
  template: {
    type: "toggle", category: "Stateful", label: "Toggle", icon: "mem",
    make: (id) => base(id, {
      type: "toggle", title: "Toggle", subtitle: "Stateful · flip on edge", icon: "mem", w: 196,
      stateful: true, config: { persistence: "seed-at-boot", initial: false },
      inputs: [{ id: "in", label: "trigger", type: "bool" }],
      outputs: [{ id: "state", label: "state", type: "bool" }],
    }),
  },
  eval: ({ inVal, seedBool }) => {
    const trig = inVal("in");
    const mem = seedBool();
    if (trig && trig.status === "ok") {
      if (trig.v === true && mem.prev === false) mem.state = !mem.state;
      mem.prev = trig.v === true;
    }
    return { outputs: { state: V("bool", mem.state === true) }, nextMemory: mem };
  },
};
