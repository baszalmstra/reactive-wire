import type { Edge } from "@xyflow/react";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyResults } from "../../../shared/results.js";
import { pinKey } from "../../../shared/identity.js";
import { V } from "../../../shared/value.js";
import type { RWNodeType } from "./validation.js";
import { EdgeValueBadge, withRWEdgeData } from "./RWEdge.js";

const nodes: RWNodeType[] = ["a", "b"].map((id) => ({
  id,
  type: "rw",
  position: { x: 0, y: 0 },
  data: {
    def: {
      id,
      type: "const-number",
      title: "Number",
      subtitle: "",
      icon: "const",
      x: 0,
      y: 0,
      inputs: [],
      outputs: [{ id: "out", label: "out", type: "num" }],
    },
  },
}));

const edges: Edge[] = ["a", "b"].map((source) => ({
  id: `edge-${source}`,
  source,
  sourceHandle: "out",
  target: "target",
  targetHandle: source,
  data: { authored: source },
}));

function results(a: number, b: number) {
  const value = emptyResults();
  value.outputs[pinKey("a", "out")] = V("num", a);
  value.outputs[pinKey("b", "out")] = V("num", b);
  return value;
}

describe("edge result decoration", () => {
  it("retains the array, edges, and data when rendered values are unchanged", () => {
    const first = withRWEdgeData(edges, nodes, results(1, 2));
    const second = withRWEdgeData(edges, nodes, results(1, 2), first);

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[0]!.data).toBe(first[0]!.data);
    expect(second[1]).toBe(first[1]);
    expect(second[1]!.data).toBe(first[1]!.data);
  });

  it("replaces only the edge whose selected output changed", () => {
    const first = withRWEdgeData(edges, nodes, results(1, 2));
    const second = withRWEdgeData(edges, nodes, results(3, 2), first);

    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
    expect(second[0]!.data).not.toBe(first[0]!.data);
    expect(second[1]).toBe(first[1]);
    expect(second[1]!.data).toBe(first[1]!.data);
  });

  it("formats datetime badges in the explicit Home Assistant timezone", () => {
    render(createElement(EdgeValueBadge, {
      value: V("datetime", Date.parse("2026-06-15T12:00:00Z")),
      timeZone: "Pacific/Kiritimati",
    }));
    expect(screen.getByText(/(?:Jun.*16|16.*Jun).*02:00/)).toBeTruthy();
  });
});
