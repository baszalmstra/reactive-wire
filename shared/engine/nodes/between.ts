import { ER, ST, UN, V } from "../../value.js";
import type { ValueType } from "../../runtime-types.js";
import { gate } from "../engine-support.js";
import { singleOutput, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

const ORDERED_TYPES = new Set<ValueType>(["num", "datetime", "duration"]);

export const between: NodeDef<"between"> = {
  type: "between",
  description: "Tests whether a value is inside configurable minimum and maximum bounds.",
  template: {
    type: "between", category: "Compare", label: "Between", icon: "cmp",
    make: (id) => base(id, {
      type: "between", title: "Between", subtitle: "Compare · ordered bounds", icon: "cmp", w: 264,
      config: { includeMin: true, includeMax: false },
      typeGroup: ["value", "min", "max"],
      inputs: [
        { id: "value", label: "value", type: "any", editable: true },
        { id: "min", label: "min", type: "any", editable: true },
        { id: "max", label: "max", type: "any", editable: true },
      ],
      outputs: [{ id: "result", label: "inside", type: "bool" }],
    }),
  },
  eval: singleOutput<"between">("result", ({ cfg, inEff }) => {
    const value = inEff("value");
    const min = inEff("min");
    const max = inEff("max");
    const status = gate([value, min, max]);
    if (status === "error") {
      const source = [value, min, max].find((input) => input?.status === "error");
      return ER("bool", source?.msg ?? "input error");
    }
    if (status === "unavailable") return UN("bool");

    const types = [value!.type, min!.type, max!.type];
    if (types[1] !== types[0] || types[2] !== types[0]) {
      return ER("bool", "value, min, and max must have the same concrete type");
    }
    const type = types[0]!;
    if (!ORDERED_TYPES.has(type)) {
      return ER("bool", `between does not support ${type} values`);
    }

    const current = value!.v as number;
    const lower = min!.v as number;
    const upper = max!.v as number;
    if (![current, lower, upper].every(Number.isFinite)) {
      return ER("bool", "value, min, and max must be finite");
    }
    if (lower > upper) return ER("bool", "min must not be greater than max");

    const insideMin = cfg.includeMin ? current >= lower : current > lower;
    const insideMax = cfg.includeMax ? current <= upper : current < upper;
    const inside = insideMin && insideMax;
    return status === "stale" ? ST("bool", inside) : V("bool", inside);
  }),
};
