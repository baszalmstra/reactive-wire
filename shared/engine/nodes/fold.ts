import { V } from "../../value.js";
import type { EvalCtx, NodeDef } from "../node-def.js";
import { applyFold, round1, toNumber } from "../engine-support.js";
import { base } from "./template-base.js";

/** Accumulate the value input into running numeric state on the rising edge of the trigger. */
function evalAccumulate({ cfg, inVal, mem }: EvalCtx) {
  const trig = inVal("in");
  const val = inVal("value");
  const m = mem();
  if (m.state === undefined) {
    m.state = toNumber(cfg.initial, 0);
    m.prev = false;
  }
  if (trig && trig.status === "ok") {
    if (trig.v === true && m.prev === false && val && val.status === "ok") {
      m.state = applyFold(String(cfg.op ?? "sum"), m.state, val.v, !m.accumulated);
      m.accumulated = true;
    }
    m.prev = trig.v === true;
  }
  return V("num", round1(toNumber(m.state, 0)));
}

export const fold: NodeDef = {
  type: "fold",
  description: "Accumulates the value into a running total on each trigger edge.",
  template: {
    type: "fold", category: "Stateful", label: "Fold", icon: "mem",
    make: (id) => base(id, {
      type: "fold", title: "Fold", subtitle: "Stateful · accumulate on edge", icon: "mem", w: 216,
      stateful: true, config: { persistence: "durable", op: "sum", initial: 0 },
      inputs: [
        { id: "value", label: "value", type: "num" },
        { id: "in", label: "trigger", type: "bool" },
      ],
      outputs: [{ id: "out", label: "total", type: "num" }],
    }),
  },
  eval: evalAccumulate,
};

export const scan: NodeDef = {
  type: "scan",
  description: "Emits a running accumulation of the value, updated on each trigger edge.",
  template: {
    type: "scan", category: "Stateful", label: "Scan", icon: "mem",
    make: (id) => base(id, {
      type: "scan", title: "Scan", subtitle: "Stateful · running accumulate", icon: "mem", w: 216,
      stateful: true, config: { persistence: "durable", op: "sum", initial: 0 },
      inputs: [
        { id: "value", label: "value", type: "num" },
        { id: "in", label: "trigger", type: "bool" },
      ],
      outputs: [{ id: "out", label: "running", type: "num" }],
    }),
  },
  eval: evalAccumulate,
};
