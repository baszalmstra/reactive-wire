import { describe, it, expect } from "vitest";
import { evaluate, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";

// Time is an injected input to evaluate(): every test passes a fixed `now` (epoch ms) so the
// results are deterministic and never depend on the wall clock.

const nowNode: NodeData = {
  id: "now", type: "now", title: "", subtitle: "", icon: "const", x: 0, y: 0,
  inputs: [], outputs: [{ id: "time", label: "", type: "datetime" }],
};

function entityNode(id: string, entity_id: string): NodeData {
  return {
    id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id },
    inputs: [],
    outputs: [
      { id: "state", label: "", type: "str" },
      { id: "last_changed", label: "", type: "datetime" },
    ],
  };
}

describe("now node", () => {
  it("emits the injected clock as a datetime, advancing as it is recomputed", () => {
    const r1 = evaluate([nowNode], [], {}, {} as Memory, 1000);
    expect(r1.outputs["now:time"]).toEqual({ type: "datetime", v: 1000, status: "ok" });
    const r2 = evaluate([nowNode], [], {}, {} as Memory, 5000);
    expect(r2.outputs["now:time"]!.v).toBe(5000);
    expect(r2.outputs["now:time"]!.type).toBe("datetime");
  });
});

describe("duration node", () => {
  const dur = (unit: string, count: number): NodeData => ({
    id: "d", type: "duration", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: { unit }, values: { count },
    inputs: [{ id: "count", label: "", type: "num", editable: true }],
    outputs: [{ id: "out", label: "", type: "duration" }],
  });
  const out = (n: NodeData) => evaluate([n], [], {}, {} as Memory, 0).outputs["d:out"]!;

  it("builds a Duration (seconds) from minutes / hours / days / seconds / ms", () => {
    expect(out(dur("min", 5)).v).toBe(300);
    expect(out(dur("hr", 2)).v).toBe(7200);
    expect(out(dur("day", 1)).v).toBe(86400);
    expect(out(dur("sec", 30)).v).toBe(30);
    expect(out(dur("ms", 1500)).v).toBe(1.5);
  });

  it("outputs the first-class Duration wire type", () => {
    expect(out(dur("min", 5)).type).toBe("duration");
  });
});

describe("since node", () => {
  // since takes a datetime instant and emits the Duration (seconds) elapsed up to now.
  const since: NodeData = {
    id: "s", type: "since", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    inputs: [{ id: "time", label: "", type: "datetime" }],
    outputs: [{ id: "elapsed", label: "", type: "duration" }],
  };

  it("computes the elapsed Duration from a wired instant to now", () => {
    const ent = entityNode("e", "binary_sensor.door");
    const edges: ViewEdge[] = [{ id: "e1", from: { node: "e", pin: "last_changed" }, to: { node: "s", pin: "time" } }];
    const entities: EntityMap = { "binary_sensor.door": { state: "on", attributes: {}, last_changed: 1_000_000 } };
    const r = evaluate([ent, since], edges, entities, {} as Memory, 1_600_000);
    // 600_000 ms = 600 s elapsed, carried as a Duration.
    expect(r.outputs["s:elapsed"]).toEqual({ type: "duration", v: 600, status: "ok" });
  });

  it("is unavailable when the instant source is unavailable", () => {
    const ent = entityNode("e", "binary_sensor.door");
    const edges: ViewEdge[] = [{ id: "e1", from: { node: "e", pin: "last_changed" }, to: { node: "s", pin: "time" } }];
    // No last_changed reported -> last_changed pin unavailable -> elapsed unavailable.
    const entities: EntityMap = { "binary_sensor.door": { state: "on", attributes: {} } };
    const r = evaluate([ent, since], edges, entities, {} as Memory, 1_600_000);
    expect(r.outputs["s:elapsed"]!.status).toBe("unavailable");
    expect(r.outputs["s:elapsed"]!.type).toBe("duration");
  });
});

describe("datetime subtract node", () => {
  // dt-subtract takes two datetime instants (a, b) and outputs the Duration a − b in seconds.
  const sub: NodeData = {
    id: "sub", type: "dt-subtract", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    inputs: [
      { id: "a", label: "", type: "datetime" },
      { id: "b", label: "", type: "datetime" },
    ],
    outputs: [{ id: "elapsed", label: "", type: "duration" }],
  };

  it("subtracts two datetimes into a Duration of seconds", () => {
    const ent = entityNode("e", "binary_sensor.door");
    const edges: ViewEdge[] = [
      { id: "e1", from: { node: "now", pin: "time" }, to: { node: "sub", pin: "a" } },
      { id: "e2", from: { node: "e", pin: "last_changed" }, to: { node: "sub", pin: "b" } },
    ];
    const entities: EntityMap = { "binary_sensor.door": { state: "on", attributes: {}, last_changed: 1_000_000 } };
    const r = evaluate([nowNode, ent, sub], edges, entities, {} as Memory, 1_300_000);
    expect(r.outputs["sub:elapsed"]).toEqual({ type: "duration", v: 300, status: "ok" });
  });

  it("propagates unavailability from either instant", () => {
    const ent = entityNode("e", "binary_sensor.door");
    const edges: ViewEdge[] = [
      { id: "e1", from: { node: "now", pin: "time" }, to: { node: "sub", pin: "a" } },
      { id: "e2", from: { node: "e", pin: "last_changed" }, to: { node: "sub", pin: "b" } },
    ];
    const entities: EntityMap = { "binary_sensor.door": { state: "on", attributes: {} } };
    const r = evaluate([nowNode, ent, sub], edges, entities, {} as Memory, 1_300_000);
    expect(r.outputs["sub:elapsed"]!.status).toBe("unavailable");
    expect(r.outputs["sub:elapsed"]!.type).toBe("duration");
  });
});

describe("datetime shift node", () => {
  // dt-shift takes a datetime and a Duration, moving the instant forward (plus) or back (minus).
  const dur: NodeData = {
    id: "d", type: "duration", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: { unit: "min" }, values: { count: 5 },
    inputs: [{ id: "count", label: "", type: "num", editable: true }],
    outputs: [{ id: "out", label: "", type: "duration" }],
  };
  const shift = (dir: string): NodeData => ({
    id: "sh", type: "dt-shift", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: { dir },
    inputs: [
      { id: "time", label: "", type: "datetime" },
      { id: "by", label: "", type: "duration" },
    ],
    outputs: [{ id: "out", label: "", type: "datetime" }],
  });
  const edges: ViewEdge[] = [
    { id: "e1", from: { node: "now", pin: "time" }, to: { node: "sh", pin: "time" } },
    { id: "e2", from: { node: "d", pin: "out" }, to: { node: "sh", pin: "by" } },
  ];

  it("adds a Duration to a datetime, staying a datetime", () => {
    const r = evaluate([nowNode, dur, shift("plus")], edges, {}, {} as Memory, 1_000_000);
    // 5 min = 300_000 ms forward.
    expect(r.outputs["sh:out"]).toEqual({ type: "datetime", v: 1_300_000, status: "ok" });
  });

  it("subtracts a Duration from a datetime when configured to minus", () => {
    const r = evaluate([nowNode, dur, shift("minus")], edges, {}, {} as Memory, 1_000_000);
    expect(r.outputs["sh:out"]).toEqual({ type: "datetime", v: 700_000, status: "ok" });
  });
});

describe("entity last_changed output", () => {
  it("surfaces the change time as a datetime, unavailable until reported", () => {
    const ent = entityNode("e", "binary_sensor.door");
    const present = evaluate([ent], [], { "binary_sensor.door": { state: "on", attributes: {}, last_changed: 42 } }, {} as Memory, 0);
    expect(present.outputs["e:last_changed"]).toEqual({ type: "datetime", v: 42, status: "ok" });
    const missing = evaluate([ent], [], { "binary_sensor.door": { state: "on", attributes: {} } }, {} as Memory, 0);
    expect(missing.outputs["e:last_changed"]!.status).toBe("unavailable");
    expect(missing.outputs["e:last_changed"]!.type).toBe("datetime");
  });
});

describe("duration condition: now() - motion.last_changed < duration(10, min)", () => {
  // motion.last_changed (datetime) -> since (Duration = now − that) -> compare against
  // duration(10, min) (Duration). The whole chain type-checks end to end as a pure derivation.
  const motion = entityNode("motion", "binary_sensor.motion");
  const since: NodeData = {
    id: "s", type: "since", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    inputs: [{ id: "time", label: "", type: "datetime" }],
    outputs: [{ id: "elapsed", label: "", type: "duration" }],
  };
  const dur: NodeData = {
    id: "d", type: "duration", title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config: { unit: "min" }, values: { count: 10 },
    inputs: [{ id: "count", label: "", type: "num", editable: true }],
    outputs: [{ id: "out", label: "", type: "duration" }],
  };
  const cmp: NodeData = {
    id: "c", type: "compare", title: "", subtitle: "", icon: "cmp", x: 0, y: 0,
    config: { op: "<" }, typeGroup: ["a", "b"],
    inputs: [{ id: "a", label: "", type: "any", editable: true }, { id: "b", label: "", type: "any", editable: true }],
    outputs: [{ id: "result", label: "", type: "bool" }],
  };
  const edges: ViewEdge[] = [
    { id: "e1", from: { node: "motion", pin: "last_changed" }, to: { node: "s", pin: "time" } },
    { id: "e2", from: { node: "s", pin: "elapsed" }, to: { node: "c", pin: "a" } },
    { id: "e3", from: { node: "d", pin: "out" }, to: { node: "c", pin: "b" } },
  ];
  const nodes = [motion, since, dur, cmp];
  const changed = 1_000_000;
  const decide = (now: number) =>
    evaluate(nodes, edges, { "binary_sensor.motion": { state: "on", attributes: {}, last_changed: changed } }, {} as Memory, now)
      .outputs["c:result"]!.v;

  it("compares Duration < Duration: true while recent, false once 10 min have passed", () => {
    expect(decide(changed + 9 * 60_000)).toBe(true); // 9 min < 10 min
    expect(decide(changed + 10 * 60_000)).toBe(false); // exactly 10 min — not strictly less
    expect(decide(changed + 11 * 60_000)).toBe(false); // 11 min > 10 min
  });

  it("resolves the compare generic pins to the Duration type", () => {
    const r = evaluate(nodes, edges, { "binary_sensor.motion": { state: "on", attributes: {}, last_changed: changed } }, {} as Memory, changed + 60_000);
    expect(r.inputs["c:a"]!.type).toBe("duration");
    expect(r.inputs["c:b"]!.type).toBe("duration");
  });
});

describe("comparing datetime with datetime", () => {
  // Two entity change-times fed into a compare that resolves its generic pins to datetime.
  const a = entityNode("a", "binary_sensor.a");
  const b = entityNode("b", "binary_sensor.b");
  const cmp: NodeData = {
    id: "c", type: "compare", title: "", subtitle: "", icon: "cmp", x: 0, y: 0,
    config: { op: "<" }, typeGroup: ["a", "b"],
    inputs: [{ id: "a", label: "", type: "any", editable: true }, { id: "b", label: "", type: "any", editable: true }],
    outputs: [{ id: "result", label: "", type: "bool" }],
  };
  const edges: ViewEdge[] = [
    { id: "e1", from: { node: "a", pin: "last_changed" }, to: { node: "c", pin: "a" } },
    { id: "e2", from: { node: "b", pin: "last_changed" }, to: { node: "c", pin: "b" } },
  ];
  const entities: EntityMap = {
    "binary_sensor.a": { state: "on", attributes: {}, last_changed: 1_000 },
    "binary_sensor.b": { state: "on", attributes: {}, last_changed: 2_000 },
  };

  it("orders two instants and resolves the generic pins to datetime", () => {
    const r = evaluate([a, b, cmp], edges, entities, {} as Memory, 0);
    expect(r.inputs["c:a"]!.type).toBe("datetime");
    expect(r.inputs["c:b"]!.type).toBe("datetime");
    expect(r.outputs["c:result"]!.v).toBe(true); // 1000 < 2000
  });
});
