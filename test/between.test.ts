import { describe, expect, it } from "vitest";
import { evaluate, type ViewEdge } from "../shared/engine/evaluate.js";
import { between } from "../shared/engine/nodes/between.js";
import { paletteDefs, REGISTRY } from "../shared/engine/nodes/index.js";
import { DEMO_HOME_LOCATION } from "../shared/home.js";
import type { NodeData } from "../shared/node-types.js";
import type { RWValue } from "../shared/value.js";
import { ER, ST, UN, V } from "../shared/value.js";

const MODES = [
  { includeMin: true, includeMax: false, expected: [true, true, false] },
  { includeMin: true, includeMax: true, expected: [true, true, true] },
  { includeMin: false, includeMax: false, expected: [false, true, false] },
  { includeMin: false, includeMax: true, expected: [false, true, true] },
] as const;

function direct(
  inputs: { value: RWValue | null; min: RWValue | null; max: RWValue | null },
  config = { includeMin: true, includeMax: false },
): RWValue {
  const node = { ...between.template.make("between"), config };
  const result = between.eval({
    n: node,
    cfg: config,
    conn: [],
    inVal: (pin) => inputs[pin as keyof typeof inputs],
    inEff: (pin) => inputs[pin as keyof typeof inputs],
    resolveType: () => "any",
    resolveGroupType: () => "any",
    seedBool: () => ({}),
    previousMemory: {},
    entities: {},
    now: 0,
    sources: {},
    environment: {},
  });
  return result.outputs.result!;
}

function numberResult(value: number, min: number, max: number, config: { includeMin: boolean; includeMax: boolean }): RWValue {
  const sources = [
    { ...REGISTRY["const-number"]!.template.make("value"), values: { out: value } },
    { ...REGISTRY["const-number"]!.template.make("min"), values: { out: min } },
    { ...REGISTRY["const-number"]!.template.make("max"), values: { out: max } },
  ];
  const target = { ...between.template.make("between"), config };
  const edges: ViewEdge[] = ["value", "min", "max"].map((pin) => ({
    id: pin,
    from: { node: pin, pin: "out" },
    to: { node: "between", pin },
  }));
  return evaluate([...sources, target], edges, {}, {}).outputs["between:result"]!;
}

describe("Between node", () => {
  it("is palette-visible with stable generic pins and no seeded literals", () => {
    const betweenIndex = paletteDefs.findIndex((definition) => definition.type === "between");
    expect(betweenIndex).toBe(paletteDefs.findIndex((definition) => definition.type === "compare") + 1);
    const node = between.template.make("between");
    expect(node).toMatchObject({
      type: "between",
      config: { includeMin: true, includeMax: false },
      typeGroup: ["value", "min", "max"],
      inputs: [
        { id: "value", type: "any", editable: true },
        { id: "min", type: "any", editable: true },
        { id: "max", type: "any", editable: true },
      ],
      outputs: [{ id: "result", label: "inside", type: "bool" }],
    });
    expect(node.stateful).toBeUndefined();
    expect(node.values).toBeUndefined();
    expect(evaluate([node], [], {}, {}).outputs["between:result"]).toEqual(UN("bool"));
  });

  it.each(MODES)("applies each numeric boundary mode", (mode) => {
    expect([numberResult(10, 10, 20, mode).v, numberResult(15, 10, 20, mode).v, numberResult(20, 10, 20, mode).v]).toEqual(mode.expected);
  });

  it("only includes equal bounds when both endpoints are closed", () => {
    for (const mode of MODES) {
      expect(numberResult(5, 5, 5, mode)).toMatchObject({ status: "ok", type: "bool", v: mode.includeMin && mode.includeMax });
    }
  });

  it("errors on reversed bounds", () => {
    expect(numberResult(5, 10, 0, MODES[0])).toMatchObject({ status: "error", type: "bool", msg: "min must not be greater than max" });
  });

  it("propagates unavailable and error, and preserves stale while computing", () => {
    expect(direct({ value: V("num", 5), min: UN("num"), max: V("num", 10) })).toEqual(UN("bool"));
    expect(direct({ value: V("num", 5), min: ER("num", "bad source"), max: V("num", 10) })).toEqual(ER("bool", "bad source"));
    expect(direct({ value: ST("num", 5), min: V("num", 0), max: V("num", 10) })).toEqual(ST("bool", true));
  });

  it("supports Duration values", () => {
    expect(direct({ value: V("duration", 300), min: V("duration", 60), max: V("duration", 600) })).toEqual(V("bool", true));
  });

  it("compares Now against real Twilight datetime outputs", () => {
    const now = Date.parse("2026-03-18T12:00:00Z");
    const clock = REGISTRY.now!.template.make("now");
    const twilight = REGISTRY.twilight!.template.make("twilight") as NodeData<"twilight">;
    twilight.config = { start: "civil-dawn", end: "civil-dusk" };
    const target = between.template.make("between");
    const edges: ViewEdge[] = [
      { id: "now", from: { node: "now", pin: "time" }, to: { node: "between", pin: "value" } },
      { id: "start", from: { node: "twilight", pin: "start" }, to: { node: "between", pin: "min" } },
      { id: "end", from: { node: "twilight", pin: "end" }, to: { node: "between", pin: "max" } },
    ];
    expect(evaluate([clock, twilight, target], edges, {}, {}, now, {}, {}, { homeLocation: DEMO_HOME_LOCATION }).outputs["between:result"]).toEqual(V("bool", true));
  });

  it("guards mixed, unsupported, and unresolved runtime types", () => {
    expect(direct({ value: V("num", 5), min: V("duration", 0), max: V("num", 10) })).toMatchObject({ status: "error", msg: /same concrete type/ });
    expect(direct({ value: V("bool", true), min: V("bool", false), max: V("bool", true) })).toMatchObject({ status: "error", msg: /does not support bool/ });
    expect(direct({ value: V("color", "#fff"), min: V("color", "#000"), max: V("color", "#fff") })).toMatchObject({ status: "error", msg: /does not support color/ });
    expect(direct({ value: V("str", "b"), min: V("str", "a"), max: V("str", "c") })).toMatchObject({ status: "error", msg: /does not support str/ });
    expect(direct({ value: V("any", 5), min: V("any", 0), max: V("any", 10) })).toMatchObject({ status: "error", msg: /does not support any/ });
  });
});
