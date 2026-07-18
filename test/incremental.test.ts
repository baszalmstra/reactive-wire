import { describe, expect, it } from "vitest";
import { compileGraph } from "../shared/engine/compile.js";
import { evaluate, evaluateIncremental } from "../shared/engine/evaluate.js";
import { createMemory } from "../shared/engine/engine-support.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";
import { pinKey } from "../shared/identity.js";
import type { EntityMap } from "../shared/entities.js";
import type { RuntimeNode } from "../shared/runtime-types.js";

function made(type: string, id: string): RuntimeNode {
  return REGISTRY[type]!.template.make(id) as RuntimeNode;
}

function boolEntity(id: string, entityId: string): RuntimeNode {
  const node = made("entity", id);
  node.config = { entity_id: entityId };
  node.outputs = [{ id: "state", label: "state", type: "bool" }];
  return node;
}

const edge = (id: string, from: string, to: string) => ({
  id,
  from: { node: from, pin: "state" },
  to: { node: to, pin: "in" },
});

function entities(values: Record<string, string>): EntityMap {
  return Object.fromEntries(Object.entries(values).map(([id, state]) => [id, { state, attributes: {} }]));
}

describe("compiled incremental evaluation", () => {
  it("builds immutable source/dependency indexes once", () => {
    const source = boolEntity("source", "binary_sensor.a");
    const not = made("not", "not");
    const now = made("now", "now");
    const since = made("since", "since");
    const sink = made("sink-input", "sink");
    sink.config = { entity_id: "input_boolean.target", kind: "boolean" };
    const compiled = compileGraph(
      [source, not, now, since, sink],
      [edge("source-not", "source", "not")],
    );

    expect(compiled.incoming.get(pinKey("not", "in"))).toEqual({ node: "source", pin: "state" });
    expect(compiled.downstream.get("source")).toEqual(["not"]);
    expect(compiled.entityRoots.get("binary_sensor.a")).toEqual(["source"]);
    expect(compiled.entityRoots.get("input_boolean.target")).toEqual(["sink"]);
    expect(compiled.clockRoots).toEqual(new Set(["now", "since"]));
    expect(compiled.sinkIds).toEqual(["sink"]);
    source.config!.entity_id = "changed-after-compile";
    expect(compiled.nodeById.get("source")?.config?.entity_id).toBe("binary_sensor.a");
    expect(Object.isFrozen(compiled.nodes)).toBe(true);
    expect(Object.isFrozen(compiled.nodes[0])).toBe(true);
  });

  it("matches full evaluation while evaluating only the dirty branch", () => {
    const a = boolEntity("a", "binary_sensor.a");
    const notA = made("not", "not-a");
    const b = boolEntity("b", "binary_sensor.b");
    const notB = made("not", "not-b");
    const edges = [edge("a-not", "a", "not-a"), edge("b-not", "b", "not-b")];
    const compiled = compileGraph([a, notA, b, notB], edges);
    const memory = createMemory();
    const initialEntities = entities({ "binary_sensor.a": "off", "binary_sensor.b": "on" });
    const initial = evaluateIncremental(compiled, null, null, initialEntities, memory, 1000);

    const nextEntities = entities({ "binary_sensor.a": "on", "binary_sensor.b": "on" });
    const incremental = evaluateIncremental(
      compiled,
      initial.results,
      compiled.entityRoots.get("binary_sensor.a") ?? [],
      nextEntities,
      memory,
      2000,
    );
    const full = evaluate(compiled.nodes, compiled.edges, nextEntities, createMemory(), 2000);

    expect(new Set(incremental.evaluatedNodeIds)).toEqual(new Set(["a", "not-a"]));
    expect(incremental.results).toBe(initial.results);
    expect(incremental.results).toEqual(full);
    expect(incremental.results.outputs[pinKey("not-b", "out")]).toBe(initial.results.outputs[pinKey("not-b", "out")]);
  });

  it("preserves every ordered stateful transition", () => {
    const source = boolEntity("source", "binary_sensor.motion");
    const rising = made("rising", "rising");
    const compiled = compileGraph([source, rising], [edge("wire", "source", "rising")]);
    const memory = createMemory();
    let state = evaluateIncremental(compiled, null, null, entities({ "binary_sensor.motion": "off" }), memory, 1);
    const pulses: boolean[] = [];
    for (const [index, value] of ["on", "off", "on"].entries()) {
      state = evaluateIncremental(
        compiled,
        state.results,
        compiled.entityRoots.get("binary_sensor.motion") ?? [],
        entities({ "binary_sensor.motion": value }),
        memory,
        index + 2,
      );
      pulses.push(state.results.outputs[pinKey("rising", "out")]?.v === true);
    }
    expect(pulses).toEqual([true, false, true]);
  });
});
