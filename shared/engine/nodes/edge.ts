import { V } from "../../value.js";
import type { EvalCtx, NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

/**
 * Detect a transition on the single input pin. Only an ok reading advances the remembered value,
 * so an offline input doesn't fire an edge. `edge` fires on any change, `rising` on false→true,
 * `falling` on true→false.
 */
function evalTransition(kind: "edge" | "rising" | "falling", { inVal, previousMemory }: EvalCtx) {
  const v = inVal("in");
  const m = { ...previousMemory };
  if (m.seeded === undefined) m.seeded = true;
  if (m.prevVal === undefined) m.prevVal = null;
  let fired = false;
  if (v && v.status === "ok") {
    const prev = m.prevVal ?? null;
    if (prev && prev.status === "ok") {
      if (kind === "edge") fired = v.v !== prev.v;
      else if (kind === "rising") fired = v.v === true && prev.v !== true;
      else fired = v.v !== true && prev.v === true;
    }
    m.prevVal = v;
  }
  return { outputs: { out: V("bool", fired) }, nextMemory: m };
}

export const edge: NodeDef = {
  type: "edge",
  description: "Pulses true for one update whenever the input value changes.",
  transactionScoped: true,
  template: {
    type: "edge", category: "Stateful", label: "Edge", icon: "mem",
    make: (id) => base(id, {
      type: "edge", title: "Edge", subtitle: "Stateful · pulse on change", icon: "mem", w: 200,
      stateful: true, config: { persistence: "seed-at-boot" },
      inputs: [{ id: "in", label: "in", type: "any" }],
      outputs: [{ id: "out", label: "changed", type: "bool" }],
    }),
  },
  eval: (ctx) => evalTransition("edge", ctx),
};

export const rising: NodeDef = {
  type: "rising",
  description: "Pulses true when the input goes from false to true.",
  transactionScoped: true,
  template: {
    type: "rising", category: "Stateful", label: "Rising", icon: "mem",
    make: (id) => base(id, {
      type: "rising", title: "Rising", subtitle: "Stateful · pulse on false→true", icon: "mem", w: 208,
      stateful: true, config: { persistence: "seed-at-boot" },
      inputs: [{ id: "in", label: "in", type: "bool" }],
      outputs: [{ id: "out", label: "rose", type: "bool" }],
    }),
  },
  eval: (ctx) => evalTransition("rising", ctx),
};

export const falling: NodeDef = {
  type: "falling",
  description: "Pulses true when the input goes from true to false.",
  transactionScoped: true,
  template: {
    type: "falling", category: "Stateful", label: "Falling", icon: "mem",
    make: (id) => base(id, {
      type: "falling", title: "Falling", subtitle: "Stateful · pulse on true→false", icon: "mem", w: 208,
      stateful: true, config: { persistence: "seed-at-boot" },
      inputs: [{ id: "in", label: "in", type: "bool" }],
      outputs: [{ id: "out", label: "fell", type: "bool" }],
    }),
  },
  eval: (ctx) => evalTransition("falling", ctx),
};
