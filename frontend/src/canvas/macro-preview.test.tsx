import { StrictMode, type PropsWithChildren } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pinKey } from "../../../shared/identity.js";
import { REGISTRY } from "../../../shared/engine/nodes/index.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";
import { evaluateMacroPreview, MACRO_PREVIEW_NOW, useMacroPreview } from "./macro-preview.js";

const NO_MACROS = {};
const NO_EDGES: ViewEdge[] = [];
const strictWrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;

function boolSource(value: boolean): NodeData {
  return { ...REGISTRY["const-bool"]!.template.make("source"), values: { out: value } };
}

function risingGraph(value: boolean): { nodes: NodeData[]; edges: ViewEdge[] } {
  const rising = REGISTRY.rising!.template.make("rising");
  return {
    nodes: [boolSource(value), rising],
    edges: [{ id: "wire", from: { node: "source", pin: "out" }, to: { node: "rising", pin: "in" } }],
  };
}

describe("macro preview evaluation", () => {
  it("uses a deterministic clock and fresh scratch memory for stateful definitions", () => {
    const clock = REGISTRY.now!.template.make("clock");
    const firstClock = evaluateMacroPreview([clock], NO_EDGES, NO_MACROS);
    const secondClock = evaluateMacroPreview([clock], NO_EDGES, NO_MACROS);
    expect(firstClock.outputs[pinKey("clock", "time")]?.v).toBe(MACRO_PREVIEW_NOW);
    expect(secondClock).toEqual(firstClock);

    // A macro preview is not an event simulator. Switching the authored literal from false to
    // true starts from a fresh baseline rather than fabricating a rising event from a prior render.
    const low = risingGraph(false);
    const high = risingGraph(true);
    expect(evaluateMacroPreview(low.nodes, low.edges, NO_MACROS).outputs[pinKey("rising", "out")]?.v).toBe(false);
    expect(evaluateMacroPreview(high.nodes, high.edges, NO_MACROS).outputs[pinKey("rising", "out")]?.v).toBe(false);
  });

  it("does not recompute for unrelated StrictMode rerenders", async () => {
    const nodes = [boolSource(true)];
    const { result, rerender } = renderHook(
      ({ defs, name }: { defs: NodeData[]; name: string }) => ({ name, results: useMacroPreview(defs, NO_EDGES, NO_MACROS) }),
      { wrapper: strictWrapper, initialProps: { defs: nodes, name: "before" } },
    );

    await waitFor(() => expect(result.current.results.outputs[pinKey("source", "out")]?.v).toBe(true));
    const committed = result.current.results;

    rerender({ defs: nodes, name: "after" });
    expect(result.current.name).toBe("after");
    expect(result.current.results).toBe(committed);

    const changed = [boolSource(false)];
    rerender({ defs: changed, name: "after" });
    await waitFor(() => expect(result.current.results.outputs[pinKey("source", "out")]?.v).toBe(false));
    expect(result.current.results).not.toBe(committed);
  });
});
