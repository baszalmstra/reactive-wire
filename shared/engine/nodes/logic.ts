import { V, UN, ER } from "../../value.js";
import { singleOutput, type EvalCtx, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

/**
 * Three-valued (Kleene) logic for AND/OR: a determined result short-circuits even when other
 * inputs are unavailable or errored, so an offline input can't flip a decided outcome. An empty
 * connected list returns the identity (true for AND, false for OR).
 */
function evalKleene(isAnd: boolean, { conn, inVal }: EvalCtx) {
  if (conn.length === 0) return V("bool", isAnd);
  const vals = conn.map((p) => inVal(p.id));
  const decisive = isAnd ? false : true;
  if (vals.some((v) => v?.status === "ok" && v.v === decisive)) return V("bool", decisive);
  const notOk = vals.filter((v) => !v || v.status !== "ok");
  if (notOk.some((v) => v?.status === "error")) return ER("bool", "input error");
  if (notOk.length > 0) return UN("bool");
  return V("bool", !decisive);
}

export const and: NodeDef = {
  type: "and",
  description: "True when every connected input is true.",
  template: {
    type: "and", category: "Logic", label: "AND", icon: "and",
    make: (id) => base(id, {
      type: "and", title: "AND", subtitle: "Logic", icon: "and", w: 178,
      inputs: [
        { id: "i0", label: "in", type: "bool" },
        { id: "i1", label: "in", type: "bool" },
        { id: "i2", label: "", type: "bool", variadic: true },
      ],
      outputs: [{ id: "out", label: "all true", type: "bool" }],
    }),
  },
  eval: singleOutput("out", (ctx) => evalKleene(true, ctx)),
};

export const or: NodeDef = {
  type: "or",
  description: "True when any connected input is true.",
  template: {
    type: "or", category: "Logic", label: "OR", icon: "and",
    make: (id) => base(id, {
      type: "or", title: "OR", subtitle: "Logic", icon: "and", w: 178,
      inputs: [
        { id: "i0", label: "in", type: "bool" },
        { id: "i1", label: "in", type: "bool" },
        { id: "i2", label: "", type: "bool", variadic: true },
      ],
      outputs: [{ id: "out", label: "any true", type: "bool" }],
    }),
  },
  eval: singleOutput("out", (ctx) => evalKleene(false, ctx)),
};

export const not: NodeDef = {
  type: "not",
  description: "Inverts a boolean.",
  template: {
    type: "not", category: "Logic", label: "NOT", icon: "cmp",
    make: (id) => base(id, {
      type: "not", title: "NOT", subtitle: "Logic", icon: "cmp", w: 166,
      inputs: [{ id: "in", label: "in", type: "bool" }],
      outputs: [{ id: "out", label: "not", type: "bool" }],
    }),
  },
  eval: singleOutput("out", ({ inVal }) => {
    const v = inVal("in");
    if (!v) return UN("bool");
    if (v.status === "error") return ER("bool", v.msg);
    if (v.status === "unavailable") return UN("bool");
    return V("bool", v.v !== true);
  }),
};
