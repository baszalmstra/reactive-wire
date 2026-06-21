import { describe, expect, it } from "vitest";
import { deriveProblems, problemCounts } from "../frontend/src/canvas/problems.js";
import type { EvalResults } from "../shared/results.js";
import type { NodeData } from "../shared/node-types.js";
import { ER, ST, UN, V } from "../shared/value.js";

function node(overrides: Partial<NodeData> = {}): NodeData {
  return {
    id: "n1",
    type: "entity",
    title: "binary_sensor.test",
    subtitle: "Entity",
    icon: "motion",
    x: 0,
    y: 0,
    inputs: [],
    outputs: [{ id: "state", label: "state", type: "bool" }],
    ...overrides,
  };
}

function results(partial: Partial<EvalResults>): EvalResults {
  return { outputs: {}, inputs: {}, health: {}, actions: {}, connected: {}, sinks: {}, ...partial };
}

describe("deriveProblems warning and error representation", () => {
  it("represents unavailable outputs as inspectable runtime warnings", () => {
    const problems = deriveProblems([node()], results({ outputs: { "n1:state": UN("bool") }, health: { n1: "warn" } }), true);

    expect(problems).toContainEqual(expect.objectContaining({
      id: "uo-n1-state",
      severity: "warn",
      scope: "runtime",
      message: "Output 'state' is unavailable.",
    }));
  });

  it("represents stale outputs as inspectable runtime warnings", () => {
    const problems = deriveProblems([node()], results({ outputs: { "n1:state": ST("bool", true) }, health: { n1: "warn" } }), true);

    expect(problems).toContainEqual(expect.objectContaining({
      id: "so-n1-state",
      severity: "warn",
      message: "Output 'state' is stale; showing the last known value.",
    }));
  });

  it("represents output errors as runtime errors with messages", () => {
    const problems = deriveProblems([node()], results({ outputs: { "n1:state": ER("bool", "bad template") }, health: { n1: "error" } }), true);

    expect(problems).toContainEqual(expect.objectContaining({
      id: "e-n1-state",
      severity: "error",
      scope: "runtime",
      message: "Output 'state' is in an error state: bad template",
    }));
  });

  it("represents ghost entity attributes as structural errors", () => {
    const n = node({ outputs: [{ id: "battery", label: "battery", type: "num", ghost: true, missing: "battery" }] });
    const problems = deriveProblems([n], results({ outputs: { "n1:battery": ER("num", "missing") }, health: { n1: "error" } }), true);

    expect(problems).toContainEqual(expect.objectContaining({
      id: "g-n1-battery",
      severity: "error",
      scope: "structural",
      message: "Attribute 'battery' is no longer exposed by the entity — pin kept as a ghost.",
    }));
  });

  it("represents unavailable, stale, and errored inputs", () => {
    const n = node({
      type: "and",
      title: "AND",
      inputs: [
        { id: "a", label: "a", type: "bool" },
        { id: "b", label: "b", type: "bool" },
        { id: "c", label: "c", type: "bool" },
      ],
      outputs: [{ id: "out", label: "out", type: "bool" }],
    });
    const problems = deriveProblems([n], results({
      inputs: { "n1:a": UN("bool"), "n1:b": ST("bool", false), "n1:c": ER("bool", "cycle") },
      outputs: { "n1:out": V("bool", false) },
      health: { n1: "error" },
    }), true);

    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ui-n1-a", severity: "warn", message: "Input 'a' is unavailable." }),
      expect.objectContaining({ id: "si-n1-b", severity: "warn", message: "Input 'b' is stale; showing the last known value." }),
      expect.objectContaining({ id: "ei-n1-c", severity: "error", message: "Input 'c' is in an error state: cycle" }),
    ]));
  });

  it("represents sink action hold/error states", () => {
    const n = node({ id: "sink", type: "sink-light", title: "Light", outputs: [], inputs: [{ id: "cmd", label: "command", type: "bool" }] });
    const hold = deriveProblems([n], results({ actions: { sink: { call: null, status: "unavailable", note: "command = unavailable — no call" } } }), true);
    const err = deriveProblems([n], results({ actions: { sink: { call: null, status: "error", note: "invalid service" } } }), true);

    expect(hold).toContainEqual(expect.objectContaining({ id: "act-u-sink", severity: "warn", message: "Sink action is holding: command = unavailable — no call." }));
    expect(err).toContainEqual(expect.objectContaining({ id: "act-e-sink", severity: "error", message: "Sink action is blocked: invalid service." }));
  });

  it("keeps select missing-input warnings structural", () => {
    const n = node({
      type: "select",
      title: "Select",
      inputs: [
        { id: "cond", label: "cond", type: "bool" },
        { id: "a", label: "a", type: "num" },
        { id: "b", label: "b", type: "num" },
      ],
      outputs: [{ id: "out", label: "out", type: "any" }],
    });
    const problems = deriveProblems([n], results({ outputs: { "n1:out": V("any", null) }, connected: {} }), true);

    expect(problems).toContainEqual(expect.objectContaining({
      id: "sel-n1",
      severity: "warn",
      scope: "structural",
      message: "Unresolved — cond, a, b not wired; output type is still 'any'.",
    }));
  });

  it("adds a Home Assistant disconnected warning when a graph exists", () => {
    const problems = deriveProblems([node()], results({ outputs: { "n1:state": V("bool", true) } }), false);

    expect(problems).toContainEqual(expect.objectContaining({ id: "ha", severity: "warn", title: "Home Assistant" }));
  });

  it("counts warnings and errors", () => {
    const counts = problemCounts([
      { id: "w", severity: "warn", scope: "runtime", node: "n", title: "n", message: "warn" },
      { id: "e", severity: "error", scope: "runtime", node: "n", title: "n", message: "err" },
    ]);

    expect(counts).toEqual({ errors: 1, warns: 1 });
  });
});
