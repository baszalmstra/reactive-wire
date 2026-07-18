import { UN } from "../../value.js";
import type { EvalCtx, NodeDef, NodeEvaluation } from "../node-def.js";
import { createRecord, setOwn } from "../../record.js";
import { MACRO_IN, MACRO_OUT } from "../../macros.js";
import { base } from "./template-base.js";

function unavailableOutputs({ n }: EvalCtx): NodeEvaluation {
  const outputs = createRecord<ReturnType<typeof UN>>();
  for (const pin of n.outputs) setOwn(outputs, pin.id, UN(pin.type));
  return { outputs };
}

/**
 * The boundary nodes that mark a macro's interface inside its definition canvas. They are dropped
 * during macro expansion (a placement's wires splice straight through them), so these definitions
 * only matter when the definition canvas itself is previewed: each macro input has no live source
 * there, so it reads as a neutral "unavailable" rather than an unknown node type that would read
 * as an error. That keeps the definition canvas legible while editing.
 */
export const macroIn: NodeDef<typeof MACRO_IN> = {
  type: MACRO_IN,
  description: "A value this macro receives from outside.",
  template: {
    type: MACRO_IN, category: "Boundary", label: "Input", icon: "io-in",
    make: (id) => base(id, {
      type: MACRO_IN, title: "Input", subtitle: "Macro input", icon: "io-in", w: 180,
      inputs: [],
      outputs: [{ id: "v", label: "value", type: "any" }],
    }),
  },
  // No outside source feeds the boundary in a definition preview, so every input pin reads as
  // unavailable — a neutral placeholder, not an error.
  eval: unavailableOutputs,
};

export const macroOut: NodeDef<typeof MACRO_OUT> = {
  type: MACRO_OUT,
  description: "A value this macro produces.",
  template: {
    type: MACRO_OUT, category: "Boundary", label: "Output", icon: "io-out",
    make: (id) => base(id, {
      type: MACRO_OUT, title: "Output", subtitle: "Macro output", icon: "io-out", w: 180,
      inputs: [{ id: "v", label: "value", type: "any" }],
      outputs: [],
    }),
  },
  // A macro-out has only inputs, so its atomic output record is empty.
  eval: unavailableOutputs,
};
