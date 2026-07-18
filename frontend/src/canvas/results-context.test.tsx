import { memo } from "react";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NodeData } from "../../../shared/node-types.js";
import { emptyResults, type EvalResults } from "../../../shared/results.js";
import { pinKey } from "../../../shared/identity.js";
import { ST, V, type RWValue } from "../../../shared/value.js";
import { ResultsProvider, type ResultsCtx, useNodeResults } from "./results-context.js";

const node = (id: string): NodeData => ({
  id, type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0,
  inputs: [], outputs: [{ id: "out", label: "out", type: "num" }],
});
const a = node("a");
const b = node("b");

function withValueObjects(aValue: RWValue<"num">, bValue: RWValue<"num">): EvalResults {
  const results = emptyResults();
  results.outputs[pinKey("a", "out")] = aValue;
  results.outputs[pinKey("b", "out")] = bValue;
  results.health.a = "ok";
  results.health.b = "ok";
  return results;
}

function withValues(aValue: number, bValue: number): EvalResults {
  return withValueObjects(V("num", aValue), V("num", bValue));
}

const renders = { a: 0, b: 0 };
const Probe = memo(function Probe({ def }: { def: NodeData }) {
  useNodeResults(def.id, def);
  renders[def.id as "a" | "b"] += 1;
  return null;
});

const onConfig = () => {};
const onSetValue = () => {};
function context(results: EvalResults): ResultsCtx {
  return { results, actuating: false, entities: {}, onConfig, onSetValue };
}

function Harness({ value }: { value: ResultsCtx }) {
  return <ResultsProvider value={value}><Probe def={a} /><Probe def={b} /></ResultsProvider>;
}

describe("node-scoped result subscriptions", () => {
  it("does not rerender a node when only another node's value changes", () => {
    renders.a = 0;
    renders.b = 0;
    const view = render(<Harness value={context(withValues(1, 2))} />);
    expect(renders).toEqual({ a: 1, b: 1 });

    act(() => view.rerender(<Harness value={context(withValues(1, 3))} />));
    expect(renders).toEqual({ a: 1, b: 2 });
  });

  it("rerenders for changed stale payloads but not equivalent stale values", () => {
    renders.a = 0;
    renders.b = 0;
    const view = render(<Harness value={context(withValueObjects(ST("num", 1), ST("num", 2)))} />);
    expect(renders).toEqual({ a: 1, b: 1 });

    act(() => view.rerender(<Harness value={context(withValueObjects(ST("num", 1), ST("num", 2)))} />));
    expect(renders).toEqual({ a: 1, b: 1 });

    act(() => view.rerender(<Harness value={context(withValueObjects(ST("num", 3), ST("num", 2)))} />));
    expect(renders).toEqual({ a: 2, b: 1 });
  });
});
