import { V } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

export const latch: NodeDef<"latch"> = {
  type: "latch",
  description: "Set makes the output true until reset makes it false. Choose which input wins when both are true.",
  template: {
    type: "latch", category: "Stateful", label: "Latch", icon: "mem",
    make: (id) => base(id, {
      type: "latch", title: "Latch", subtitle: "Stateful · set / reset", icon: "mem", w: 196,
      stateful: true, config: { persistence: "seed-at-boot", initial: false, priority: "reset" },
      inputs: [
        { id: "set", label: "set", type: "bool" },
        { id: "reset", label: "reset", type: "bool" },
      ],
      outputs: [{ id: "state", label: "state", type: "bool" }],
    }),
  },
  eval: ({ cfg, inVal, seedBool }) => {
    const setInput = inVal("set");
    const resetInput = inVal("reset");
    const setHigh = setInput?.status === "ok" && setInput.v === true;
    const resetHigh = resetInput?.status === "ok" && resetInput.v === true;
    const memory = seedBool();
    if (setHigh && resetHigh) memory.state = cfg.priority === "set";
    else if (resetHigh) memory.state = false;
    else if (setHigh) memory.state = true;
    return { outputs: { state: V("bool", memory.state === true) }, nextMemory: memory };
  },
};
