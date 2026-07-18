import type { Meta, StoryObj } from "@storybook/react";
import { ReactFlow, ReactFlowProvider, type Edge, type NodeProps } from "@xyflow/react";
import { evaluate, type ViewEdge } from "../../../shared/engine/evaluate.js";
import { REGISTRY } from "../../../shared/engine/nodes/index.js";
import { DEMO_HOME_LOCATION } from "../../../shared/home.js";
import type { NodeData } from "../../../shared/node-types.js";
import { ResultsProvider } from "./results-context.js";
import { RWEdge, withRWEdgeData } from "./RWEdge.js";
import { RWNode } from "./RWNode.js";
import { environmentalStoryFixture } from "./time-story-fixtures.js";
import type { RWNodeType } from "./validation.js";

function TimeNode({ kind }: { kind: "time-of-day" | "twilight" }) {
  const { node: def, results } = environmentalStoryFixture(kind, kind);
  const props = { id: def.id, data: { def }, selected: false } as unknown as NodeProps<RWNodeType>;
  return (
    <ReactFlowProvider>
      <ResultsProvider value={{ results, actuating: false, entities: {}, homeLocation: DEMO_HOME_LOCATION, onConfig: () => {}, onSetValue: () => {} }}>
        <RWNode {...props} />
      </ResultsProvider>
    </ReactFlowProvider>
  );
}

const nodeTypes = { rw: RWNode };
const edgeTypes = { rw: RWEdge };
const USAGE_NOW = Date.parse("2026-03-18T18:30:00Z");

function placed(def: NodeData, x: number, y: number): RWNodeType {
  return { id: def.id, type: "rw", position: { x, y }, data: { def } };
}

function made(type: string, id: string, patch: Partial<NodeData> = {}): NodeData {
  return { ...REGISTRY[type]!.template.make(id), ...patch } as NodeData;
}

function TwilightSwitchingExample() {
  const defs: NodeData[] = [
    made("twilight", "twilight", { title: "Outdoor twilight" }),
    made("now", "now"),
    made("between", "inside", { title: "Inside twilight" }),
    made("const-color", "warm", { title: "Twilight color", values: { out: "#ff9d52" } }),
    made("const-color", "day", { title: "Day color", values: { out: "#d9efff" } }),
    made("select", "select", { title: "Twilight switch" }),
  ];
  const positions: Record<string, [number, number]> = {
    twilight: [20, 30], now: [30, 280], inside: [370, 120],
    warm: [420, 390], day: [420, 520], select: [760, 245],
  };
  const viewEdges: ViewEdge[] = [
    { id: "now-value", from: { node: "now", pin: "time" }, to: { node: "inside", pin: "value" } },
    { id: "tw-start", from: { node: "twilight", pin: "start" }, to: { node: "inside", pin: "min" } },
    { id: "tw-end", from: { node: "twilight", pin: "end" }, to: { node: "inside", pin: "max" } },
    { id: "inside-select", from: { node: "inside", pin: "result" }, to: { node: "select", pin: "cond" } },
    { id: "warm-select", from: { node: "warm", pin: "out" }, to: { node: "select", pin: "a" } },
    { id: "day-select", from: { node: "day", pin: "out" }, to: { node: "select", pin: "b" } },
  ];
  const results = evaluate(defs, viewEdges, {}, {}, USAGE_NOW, {}, {}, { homeLocation: DEMO_HOME_LOCATION });
  const nodes = defs.map((def) => placed(def, ...positions[def.id]!));
  const rawEdges: Edge[] = viewEdges.map((edge) => ({
    id: edge.id,
    source: edge.from.node,
    sourceHandle: edge.from.pin,
    target: edge.to.node,
    targetHandle: edge.to.pin,
  }));
  const edges = withRWEdgeData(rawEdges, nodes, results, undefined, DEMO_HOME_LOCATION.timeZone);

  return (
    <section style={{ width: 1280, maxWidth: "100%", color: "var(--rw-text)" }}>
      <div style={{ margin: "0 0 10px 8px" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Switch values during a twilight range</h2>
        <p style={{ margin: "4px 0 0", color: "var(--rw-dim)", fontSize: 12 }}>
          Between checks whether Now is inside the selected twilight range using [min, max), then Select chooses the desired outdoor-light color.
        </p>
      </div>
      <div style={{ height: 620, border: "1px solid var(--rw-line)", borderRadius: 12, overflow: "hidden", background: "var(--rw-canvas)" }}>
        <ResultsProvider value={{ results, actuating: false, entities: {}, homeLocation: DEMO_HOME_LOCATION, onConfig: () => {}, onSetValue: () => {} }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 0.92 }}
            minZoom={0.5}
            maxZoom={1}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          />
        </ResultsProvider>
      </div>
    </section>
  );
}

const meta: Meta<typeof TimeNode> = { title: "Nodes/Environmental time", component: TimeNode };
export default meta;
type Story = StoryObj<typeof TimeNode>;

export const TimeOfDay: Story = { args: { kind: "time-of-day" } };
export const TwilightRange: Story = { args: { kind: "twilight" } };
export const Gallery: Story = {
  render: () => <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "flex-start", maxWidth: "100%" }}><TimeNode kind="time-of-day" /><TimeNode kind="twilight" /></div>,
};
export const TwilightSwitching: Story = { render: () => <TwilightSwitchingExample /> };
