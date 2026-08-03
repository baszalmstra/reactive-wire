import { describe, expect, it } from "vitest";
import { evaluate, type ViewEdge } from "../shared/engine/evaluate.js";
import { available } from "../shared/engine/nodes/available.js";
import { paletteDefs, REGISTRY } from "../shared/engine/nodes/index.js";
import type { RWValue } from "../shared/value.js";
import { ER, ST, UN, V } from "../shared/value.js";

function direct(input: RWValue | null): RWValue {
  const node = available.template.make("available");
  return available.eval({
    n: node,
    cfg: {},
    conn: [],
    inVal: () => input,
    inEff: () => input,
    resolveType: () => "any",
    resolveGroupType: () => "any",
    seedBool: () => ({}),
    previousMemory: {},
    entities: {},
    now: 0,
    sources: {},
    environment: {},
  }).outputs.out!;
}

/** Wire an entity's state pin into the probe and read the probe's answer. */
function fromEntity(state: string): RWValue {
  const entity = { ...REGISTRY.entity!.template.make("sensor"), config: { entity_id: "sensor.probe" } };
  const probe = available.template.make("available");
  const edges: ViewEdge[] = [{ id: "w", from: { node: "sensor", pin: "state" }, to: { node: "available", pin: "in" } }];
  const entities = { "sensor.probe": { entity_id: "sensor.probe", state, attributes: { unit_of_measurement: "°C" } } };
  return evaluate([entity, probe], edges, entities, {}).outputs["available:out"]!;
}

describe("Available node", () => {
  it("sits beside the other Logic nodes with a generic input and a boolean output", () => {
    expect(paletteDefs.findIndex((d) => d.type === "available")).toBe(paletteDefs.findIndex((d) => d.type === "not") + 1);
    expect(available.template.make("available")).toMatchObject({
      type: "available",
      inputs: [{ id: "in", type: "any" }],
      outputs: [{ id: "out", label: "available", type: "bool" }],
    });
    expect(available.template.category).toBe("Logic");
  });

  it("answers false for an unavailable input rather than propagating it", () => {
    expect(direct(UN("num"))).toEqual(V("bool", false));
  });

  it("answers true for any value that is actually present", () => {
    expect(direct(V("num", 0))).toEqual(V("bool", true));
    expect(direct(V("bool", false))).toEqual(V("bool", true));
    expect(direct(V("str", ""))).toEqual(V("bool", true));
  });

  it("treats an errored input as not available", () => {
    expect(direct(ER("num", "bad source"))).toEqual(V("bool", false));
  });

  it("answers false when nothing is wired in", () => {
    expect(direct(null)).toEqual(V("bool", false));
    const lone = available.template.make("available");
    expect(evaluate([lone], [], {}, {}).outputs["available:out"]).toEqual(V("bool", false));
  });

  it("keeps a stale payload's answer true but marks the answer stale", () => {
    expect(direct(ST("num", 5))).toEqual(ST("bool", true));
  });

  it("never reports a non-ok status of its own, whatever arrives", () => {
    for (const input of [null, UN("num"), ER("num", "x"), V("num", 1)]) {
      expect(direct(input).status).toBe("ok");
    }
  });

  it("flips as a live entity drops out and comes back", () => {
    expect(fromEntity("21.5")).toEqual(V("bool", true));
    expect(fromEntity("unavailable")).toEqual(V("bool", false));
    expect(fromEntity("unknown")).toEqual(V("bool", false));
    expect(fromEntity("22.0")).toEqual(V("bool", true));
  });
});
