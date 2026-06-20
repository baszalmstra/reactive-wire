import { V, UN, ER } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { applyCompare, gate } from "../engine-support.js";
import { base } from "./template-base.js";

export const compare: NodeDef = {
  type: "compare",
  description: "Compares two values with the chosen operator and outputs a boolean.",
  template: {
    type: "compare", category: "Compare", label: "Compare", icon: "cmp",
    make: (id) => base(id, {
      type: "compare", title: "compare", subtitle: "Compare", icon: "cmp", w: 264,
      config: { op: "<" },
      typeGroup: ["a", "b"],
      values: { a: 0, b: 0 },
      inputs: [
        { id: "a", label: "a", type: "any", editable: true },
        { id: "b", label: "b", type: "any", editable: true },
      ],
      outputs: [{ id: "result", label: "result", type: "bool" }],
    }),
  },
  eval: ({ cfg, inEff }) => {
    const a = inEff("a");
    const b = inEff("b");
    const g = gate([a, b]);
    if (g === "error") return ER("bool", "input error");
    if (g === "unavailable") return UN("bool");
    return V("bool", applyCompare(a!.v, String(cfg.op ?? "<"), b!.v));
  },
};
