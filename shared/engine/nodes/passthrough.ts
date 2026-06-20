import { UN } from "../../value.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

/**
 * An identity node produced by macro expansion: its output equals its single input, or the
 * input's editable default when nothing is wired. It carries a macro input's value into the
 * subgraph unchanged. It has no palette entry — only macro expansion creates it.
 */
export const passthrough: NodeDef = {
  type: "passthrough",
  description: "",
  template: {
    type: "passthrough", category: "", label: "", icon: "macro",
    make: (id) => base(id, {
      type: "passthrough", title: "", subtitle: "", icon: "macro",
      inputs: [{ id: "in", label: "", type: "any" }],
      outputs: [{ id: "out", label: "", type: "any" }],
    }),
  },
  eval: ({ n, pinId, inEff }) => {
    const v = inEff(pinId);
    if (!v) return UN(n.outputs.find((p) => p.id === pinId)?.type ?? "any");
    return v;
  },
};
