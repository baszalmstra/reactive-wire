import { ST, V, type RWValue } from "../../value.js";
import { singleOutput, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

/**
 * Whether a value carries a payload. The value model splits exactly this way: ok and stale hold a
 * payload, while unavailable and error are absent. An unwired pin has nothing to report on at all.
 */
function carriesValue(value: RWValue | null): boolean {
  return value !== null && (value.status === "ok" || value.status === "stale");
}

export const available: NodeDef<"available"> = {
  type: "available",
  description: "True while the input carries a value, false while it is unavailable or errored.",
  template: {
    type: "available", category: "Logic", label: "Available", icon: "cmp",
    make: (id) => base(id, {
      type: "available", title: "Available", subtitle: "Logic", icon: "cmp", w: 178,
      inputs: [{ id: "in", label: "in", type: "any" }],
      outputs: [{ id: "out", label: "available", type: "bool" }],
    }),
  },
  /**
   * Total by design: every input state answers with a boolean, so a graph can branch on
   * availability instead of going unavailable alongside the value it is asking about. A stale
   * payload still answers true, but carries the staleness so the answer is not read as fresh.
   */
  eval: singleOutput<"available">("out", ({ inVal }) => {
    const value = inVal("in");
    if (value?.status === "stale") return ST("bool", true);
    return V("bool", carriesValue(value));
  }),
};
