import { useMemo, useState } from "react";
import { Handle, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import type { Meta, StoryObj } from "@storybook/react";
import { TYPE_LABEL, TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { ER, ST, UN, V, type RWValue } from "../../../shared/value.js";
import { RWEdge, type RWEdgeData } from "./RWEdge.js";

type WireStatus = RWValue["status"];

type Sample = {
  type: ValueType;
  value: RWValue;
  note: string;
};

type PlaygroundState = {
  type: ValueType;
  status: WireStatus;
  boolValue: boolean;
  numValue: number;
  strValue: string;
  colorValue: string;
  durationValue: number;
  datetimeValue: string;
  anyValue: string;
};

const nodeTypes = { "wire-anchor": WireAnchor };
const edgeTypes = { rw: RWEdge };

const TYPE_OPTIONS: ValueType[] = ["bool", "num", "str", "color", "duration", "datetime", "any"];
const STATUS_OPTIONS: WireStatus[] = ["ok", "stale", "unavailable", "error"];

const SAMPLES: Sample[] = [
  { type: "bool", value: V("bool", true), note: "binary state" },
  { type: "num", value: V("num", 21.7), note: "sensor reading" },
  { type: "str", value: V("str", "heating"), note: "mode / label" },
  { type: "color", value: V("color", "#ffcf5a"), note: "desired color" },
  { type: "duration", value: V("duration", 900), note: "elapsed / timeout" },
  { type: "datetime", value: V("datetime", Date.UTC(2026, 5, 15, 18, 30)), note: "instant" },
  { type: "any", value: V("any", "unresolved"), note: "generic" },
];

const STATUS_SAMPLES: Sample[] = [
  { type: "bool", value: V("bool", true), note: "ok true" },
  { type: "bool", value: V("bool", false), note: "ok false" },
  { type: "num", value: ST("num", 19.4), note: "stale" },
  { type: "str", value: UN("str"), note: "unavailable" },
  { type: "num", value: ER("num", "bad input"), note: "error" },
];

function WireAnchor() {
  return (
    <div className="wire-anchor-node">
      <Handle type="target" position={Position.Left} id="in" className="wire-anchor-handle" />
      <Handle type="source" position={Position.Right} id="out" className="wire-anchor-handle" />
    </div>
  );
}

function rawValue(state: PlaygroundState): unknown {
  switch (state.type) {
    case "bool": return state.boolValue;
    case "num": return state.numValue;
    case "str": return state.strValue;
    case "color": return state.colorValue;
    case "duration": return state.durationValue;
    case "datetime": return Date.parse(state.datetimeValue);
    case "any": return state.anyValue;
  }
}

function valueFromState(state: PlaygroundState): RWValue {
  if (state.status === "error") return ER(state.type, "example error");
  if (state.status === "unavailable") return UN(state.type);
  const raw = rawValue(state);
  return state.status === "stale" ? ST(state.type, raw) : V(state.type, raw);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="wire-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ValueControl({ state, setState }: { state: PlaygroundState; setState: (next: PlaygroundState) => void }) {
  if (state.status === "unavailable" || state.status === "error") {
    return <p className="wire-muted">No carried value is shown while the wire is {state.status}.</p>;
  }
  switch (state.type) {
    case "bool":
      return (
        <Field label="Value">
          <select value={String(state.boolValue)} onChange={(e) => setState({ ...state, boolValue: e.target.value === "true" })}>
            <option value="true">on / true</option>
            <option value="false">off / false</option>
          </select>
        </Field>
      );
    case "num":
      return (
        <Field label="Value">
          <input type="number" value={state.numValue} onChange={(e) => setState({ ...state, numValue: Number(e.target.value) })} />
        </Field>
      );
    case "str":
      return (
        <Field label="Value">
          <input value={state.strValue} onChange={(e) => setState({ ...state, strValue: e.target.value })} />
        </Field>
      );
    case "color":
      return (
        <Field label="Value">
          <input type="color" value={state.colorValue} onChange={(e) => setState({ ...state, colorValue: e.target.value })} />
        </Field>
      );
    case "duration":
      return (
        <Field label="Seconds">
          <input type="number" min={0} value={state.durationValue} onChange={(e) => setState({ ...state, durationValue: Number(e.target.value) })} />
        </Field>
      );
    case "datetime":
      return (
        <Field label="Value">
          <input type="datetime-local" value={state.datetimeValue} onChange={(e) => setState({ ...state, datetimeValue: e.target.value })} />
        </Field>
      );
    case "any":
      return (
        <Field label="Value">
          <input value={state.anyValue} onChange={(e) => setState({ ...state, anyValue: e.target.value })} />
        </Field>
      );
  }
}

function ActualWirePreview({ sample, id }: { sample: Sample; id: string }) {
  const nodes = useMemo<Node[]>(() => [
    { id: `${id}-source`, type: "wire-anchor", position: { x: 16, y: 32 }, data: {} },
    { id: `${id}-target`, type: "wire-anchor", position: { x: 420, y: 32 }, data: {} },
  ], [id]);
  const edges = useMemo<Edge<RWEdgeData>[]>(() => [{
    id: `${id}-edge`,
    type: "rw",
    source: `${id}-source`,
    sourceHandle: "out",
    target: `${id}-target`,
    targetHandle: "in",
    data: { valueType: sample.type, value: sample.value },
  }], [id, sample.type, sample.value]);

  return (
    <div className="wire-flow-preview">
      <ReactFlow<Node, Edge<RWEdgeData>>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1.08 }}
        minZoom={0.5}
        maxZoom={1.4}
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
    </div>
  );
}

function Playground() {
  const [state, setState] = useState<PlaygroundState>({
    type: "bool",
    status: "ok",
    boolValue: true,
    numValue: 21.7,
    strValue: "heating",
    colorValue: "#ffcf5a",
    durationValue: 900,
    datetimeValue: "2026-06-15T18:30",
    anyValue: "unresolved",
  });
  const sample: Sample = { type: state.type, value: valueFromState(state), note: "interactive" };

  return (
    <section className="wire-playground">
      <div className="wire-playground-head">
        <h2>Interactive playground</h2>
        <p>This uses the same React Flow edge component as the app canvas.</p>
      </div>
      <div className="wire-controls">
        <Field label="Type">
          <select value={state.type} onChange={(e) => setState({ ...state, type: e.target.value as ValueType })}>
            {TYPE_OPTIONS.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={state.status} onChange={(e) => setState({ ...state, status: e.target.value as WireStatus })}>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </Field>
        <ValueControl state={state} setState={setState} />
      </div>
      <ActualWirePreview sample={sample} id="playground" />
    </section>
  );
}

function WireRow({ sample }: { sample: Sample }) {
  return (
    <div className="wire-row">
      <div className="wire-row-label">
        <span className="wire-type-dot" style={{ background: TYPE_VAR[sample.type] }} />
        <strong>{TYPE_LABEL[sample.type]}</strong>
        <small>{sample.note}</small>
      </div>
      <ActualWirePreview sample={sample} id={`sample-${sample.type}`} />
    </div>
  );
}

function StatusGallery() {
  return (
    <section className="wire-section">
      <h2>Status handling</h2>
      <p>Status owns line treatment: solid, muted dashed, faint dotted, red dashed. Boolean true gets the moving highlight; false does not.</p>
      <div className="wire-status-grid">
        {STATUS_SAMPLES.map((sample) => (
          <div className="wire-status-card" key={sample.note}>
            <small>{sample.note}</small>
            <ActualWirePreview sample={sample} id={`status-${sample.note.replace(/\W+/g, "-")}`} />
          </div>
        ))}
      </div>
    </section>
  );
}

function WireStyles() {
  return (
    <div className="wire-page">
      <style>{css}</style>
      <header className="wire-header">
        <div>
          <h1>Wire styles</h1>
          <p>
            Actual canvas edge component: type is color, status is line treatment, and the carried value is shown as a compact badge.
          </p>
        </div>
      </header>

      <Playground />

      <section className="wire-section">
        <h2>Value types</h2>
        <div className="wire-table">
          {SAMPLES.map((sample) => <WireRow key={sample.type} sample={sample} />)}
        </div>
      </section>

      <StatusGallery />
    </div>
  );
}

const css = `
.wire-page { width: min(1080px, calc(100vw - 64px)); color: var(--rw-text); }
.wire-header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.wire-header h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -0.03em; }
.wire-header p { margin: 0; max-width: 820px; color: var(--rw-dim); line-height: 1.55; }
.wire-section, .wire-playground { margin-bottom: 22px; padding: 16px; border: 1px solid var(--rw-line-soft); border-radius: 18px; background: color-mix(in oklab, var(--rw-panel) 72%, transparent); }
.wire-section h2, .wire-playground h2 { margin: 0 0 4px; font-size: 16px; }
.wire-section p, .wire-playground p { margin: 0; color: var(--rw-faint); font-size: 12px; line-height: 1.45; }
.wire-playground-head { display: flex; justify-content: space-between; gap: 18px; align-items: baseline; margin-bottom: 14px; }
.wire-controls { display: grid; grid-template-columns: 180px 180px minmax(220px, 1fr); gap: 12px; align-items: end; margin-bottom: 14px; }
.wire-field { display: flex; flex-direction: column; gap: 5px; }
.wire-field > span { color: var(--rw-faint); font-size: 10px; text-transform: uppercase; letter-spacing: .07em; }
.wire-field input, .wire-field select { height: 31px; border: 1px solid var(--rw-line); border-radius: 8px; background: var(--rw-panel2); color: var(--rw-text); padding: 0 9px; font: 12px var(--font-mono); outline: none; }
.wire-field input:focus, .wire-field select:focus { border-color: var(--rw-accent); }
.wire-muted { color: var(--rw-faint); font-size: 12px; margin: 0 0 7px; }
.wire-table { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
.wire-row { display: grid; grid-template-columns: 180px minmax(320px, 1fr); gap: 14px; align-items: center; padding: 11px 14px; border: 1px solid var(--rw-line-soft); border-radius: 14px; background: color-mix(in oklab, var(--rw-canvas) 74%, transparent); }
.wire-row-label { display: grid; grid-template-columns: 12px 1fr; column-gap: 9px; row-gap: 3px; align-items: center; }
.wire-row-label small { grid-column: 2; color: var(--rw-faint); font-size: 11px; }
.wire-type-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in oklab, currentColor 6%, transparent); }
.wire-flow-preview { height: 82px; min-width: 300px; border-radius: 12px; border: 1px solid color-mix(in oklab, var(--rw-line-soft) 72%, transparent); background: color-mix(in oklab, var(--rw-canvas) 88%, transparent); overflow: hidden; }
.wire-flow-preview .react-flow__node { opacity: 0; pointer-events: none; }
.wire-flow-preview .react-flow__handle { opacity: 0; pointer-events: none; }
.wire-flow-preview .react-flow__pane { cursor: default; }
.wire-anchor-node { width: 1px; height: 1px; }
.wire-anchor-handle { width: 1px; height: 1px; min-width: 1px; min-height: 1px; border: 0; background: transparent; }
.wire-status-grid { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 12px; margin-top: 14px; }
.wire-status-card { padding: 10px; border: 1px solid var(--rw-line-soft); border-radius: 14px; background: color-mix(in oklab, var(--rw-canvas) 74%, transparent); }
.wire-status-card small { display: block; margin: 0 0 6px; color: var(--rw-faint); font: 10px var(--font-mono); text-transform: uppercase; letter-spacing: .06em; }
@media (max-width: 920px) {
  .wire-row, .wire-controls, .wire-status-grid { grid-template-columns: 1fr; }
}
`;

const meta: Meta<typeof WireStyles> = {
  title: "Canvas/Wires",
  component: WireStyles,
};
export default meta;

type Story = StoryObj<typeof WireStyles>;

export const LiveStyles: Story = {};
