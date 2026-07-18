import { UN, ER } from "../../value.js";
import { singleOutput, type NodeDef } from "../node-def.js";
import { gate } from "../engine-support.js";
import { base } from "./template-base.js";

export const select: NodeDef = {
  type: "select",
  description: "Outputs the “then” value when the condition is true, otherwise the “else” value.",
  template: {
    type: "select", category: "Flow", label: "Select", icon: "sel",
    make: (id) => base(id, {
      type: "select", title: "Select", subtitle: "Generic · resolves on wire", icon: "sel", w: 196,
      inputs: [
        { id: "cond", label: "if", type: "bool" },
        { id: "a", label: "then", type: "any" },
        { id: "b", label: "else", type: "any" },
      ],
      outputs: [{ id: "out", label: "value", type: "any" }],
    }),
  },
  eval: singleOutput("out", ({ resolveType, inVal }) => {
    const t = resolveType("any", ["a", "b"]);
    const cond = inVal("cond");
    if (!cond) return UN(t);
    const g = gate([cond]);
    if (g === "error") return ER(t, "condition error");
    if (g === "unavailable") return UN(t);
    const picked = cond.v ? inVal("a") : inVal("b");
    return picked ?? UN(t);
  }),
};
