import { render, screen } from "@testing-library/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { pinKey } from "../../../shared/identity.js";
import type { NodeData } from "../../../shared/node-types.js";
import { emptyResults } from "../../../shared/results.js";
import { V } from "../../../shared/value.js";
import { Inspector } from "./Inspector.js";
import { ResultsProvider } from "./results-context.js";
import { RWNode } from "./RWNode.js";
import type { RWNodeType } from "./validation.js";

const noop = () => {};

function renderNode(def: NodeData, results = emptyResults(), timeZone?: string) {
  const props = { id: def.id, data: { def }, selected: false } as unknown as NodeProps<RWNodeType>;
  return render(
    <ReactFlowProvider>
      <ResultsProvider value={{ results, actuating: false, entities: {}, homeLocation: timeZone ? { latitude: 0, longitude: 0, elevation: 0, timeZone } : null, onConfig: noop, onSetValue: noop }}>
        <RWNode {...props} />
      </ResultsProvider>
    </ReactFlowProvider>,
  );
}

function lightNode(id: string): NodeData {
  return {
    id,
    type: "sink-light",
    title: "Light",
    subtitle: "Light sink",
    icon: "bulb",
    x: 0,
    y: 0,
    inputs: [
      { id: "on", label: "on", type: "bool" },
      { id: "color", label: "color", type: "color" },
      { id: "brightness", label: "brightness", type: "num" },
    ],
    outputs: [],
    config: { entity_id: "light.test" },
  };
}

describe("collision-free frontend result consumers", () => {
  it("renders the light glyph and inspector preview for a delimiter-containing node id", () => {
    const def = lightNode("light:west");
    const results = emptyResults();
    results.inputs[pinKey(def.id, "on")] = V("bool", true);
    results.inputs[pinKey(def.id, "color")] = V("color", "#123456");
    results.inputs[pinKey(def.id, "brightness")] = V("num", 255);

    const nodeView = renderNode(def, results);
    const glyph = nodeView.container.querySelector<HTMLElement>(".rw-drag > span[style]");
    expect(glyph?.style.color).toBe("rgb(18, 52, 86)");
    nodeView.unmount();

    render(
      <Inspector
        node={def}
        results={results}
        entities={{}}
        onConfig={noop}
        onSetValue={noop}
      />,
    );
    expect(screen.getAllByText("on").length).toBeGreaterThan(0);
    expect(screen.getByText(/^#123456/)).toBeTruthy();
  });

  it("formats generic canvas datetime output chips in the Home Assistant timezone", () => {
    const def: NodeData = {
      id: "time", type: "now", title: "Time", subtitle: "Time", icon: "timestamp", x: 0, y: 0,
      inputs: [], outputs: [{ id: "out", label: "out", type: "datetime" }],
    };
    const results = emptyResults();
    results.outputs[pinKey(def.id, "out")] = V("datetime", Date.parse("2026-06-15T12:00:00Z"));
    renderNode(def, results, "Pacific/Kiritimati");
    expect(screen.getByText(/(?:Jun.*16|16.*Jun).*02:00/)).toBeTruthy();
  });

  it("resolves compare operator choices for a delimiter-containing node id", () => {
    const def: NodeData = {
      id: "compare:west",
      type: "compare",
      title: "Compare",
      subtitle: "Compare",
      icon: "cmp",
      x: 0,
      y: 0,
      inputs: [
        { id: "a", label: "a", type: "any" },
        { id: "b", label: "b", type: "any" },
      ],
      outputs: [{ id: "out", label: "out", type: "bool" }],
      config: { op: "==" },
      typeGroup: ["a", "b"],
    };
    const results = emptyResults();
    results.inputs[pinKey(def.id, "a")] = V("num", 1);

    const { container } = renderNode(def, results);
    const values = [...container.querySelectorAll("option")].map((option) => option.value);
    expect(values).toContain("<");
    expect(values).toContain(">");
  });
});
