import { V, UN, ER } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { gate, round1 } from "../engine-support.js";
import { base } from "./template-base.js";

export const sum: NodeDef = {
  type: "sum",
  description: "Adds all connected number inputs.",
  template: {
    type: "sum", category: "Math", label: "Sum", icon: "const",
    make: (id) => base(id, {
      type: "sum", title: "SUM", subtitle: "Math", icon: "const", w: 178,
      inputs: [
        { id: "i0", label: "in", type: "num" },
        { id: "i1", label: "in", type: "num" },
        { id: "i2", label: "", type: "num", variadic: true },
      ],
      outputs: [{ id: "out", label: "sum", type: "num" }],
    }),
  },
  eval: ({ conn, inVal }) => {
    if (conn.length === 0) return UN("num");
    const vals = conn.map((p) => inVal(p.id));
    const g = gate(vals);
    if (g === "error") return ER("num", "input error");
    if (g === "unavailable") return UN("num");
    return V("num", round1(vals.reduce((s, x) => s + (Number(x!.v) || 0), 0)));
  },
};
