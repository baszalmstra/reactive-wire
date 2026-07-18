import { BaseEdge, EdgeLabelRenderer, getBezierPath, useConnection, type Edge, type EdgeProps } from "@xyflow/react";
import { type CSSProperties, useMemo, useRef } from "react";
import { TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { UN, formatValue, type RWValue, type Status } from "../../../shared/value.js";
import type { EvalResults } from "../../../shared/results.js";
import type { RWNodeType } from "./validation.js";
import { pinKey } from "../../../shared/identity.js";

export type RWEdgeData = Record<string, unknown> & {
  valueType?: ValueType;
  value?: RWValue | null;
};

export type RWEdgeType = Edge<RWEdgeData, "rw">;

function sourcePinType(nodes: RWNodeType[], edge: Edge): ValueType {
  const source = nodes.find((node) => node.id === edge.source);
  const pin = source?.data.def.outputs.find((output) => output.id === edge.sourceHandle);
  return pin?.type ?? "any";
}

interface DecoratedEdgeCache {
  baseData: Edge["data"];
  valueType: ValueType;
  value: RWValue | null;
  edge: RWEdgeType;
}

const decoratedByBase = new WeakMap<Edge, DecoratedEdgeCache>();

function sameEdgeValue(a: RWValue | null, b: RWValue | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.status !== b.status || a.type !== b.type) return false;
  if (a.status === "ok" || a.status === "stale") return Object.is(a.v, b.v);
  return a.msg === b.msg;
}

/** Decorate edges while preserving identities for edges whose rendered value did not change. */
export function withRWEdgeData(
  edges: Edge[],
  nodes: RWNodeType[],
  results: EvalResults,
  previous?: RWEdgeType[],
): RWEdgeType[] {
  const decorated = edges.map((edge) => {
    const fallbackType = sourcePinType(nodes, edge);
    const value = edge.sourceHandle ? results.outputs[pinKey(edge.source, edge.sourceHandle)] ?? null : null;
    const valueType = value?.type ?? fallbackType;
    const cached = decoratedByBase.get(edge);
    if (cached && cached.baseData === edge.data && cached.valueType === valueType
      && sameEdgeValue(cached.value, value)) return cached.edge;
    const next: RWEdgeType = {
      ...edge,
      type: "rw",
      animated: false,
      data: {
        ...edge.data,
        valueType,
        value,
      },
    };
    decoratedByBase.set(edge, { baseData: edge.data, valueType, value, edge: next });
    return next;
  });
  if (previous?.length === decorated.length
    && decorated.every((edge, index) => edge === previous[index])) return previous;
  return decorated;
}

/** Retain both the decorated array and each clean edge across unrelated evaluation updates. */
export function useRWEdgeData(edges: Edge[], nodes: RWNodeType[], results: EvalResults): RWEdgeType[] {
  const previous = useRef<RWEdgeType[] | undefined>(undefined);
  return useMemo(() => {
    const next = withRWEdgeData(edges, nodes, results, previous.current);
    previous.current = next;
    return next;
  }, [edges, nodes, results]);
}

function edgeStatus(value: RWValue): Status {
  if (value.status === "error") return "error";
  if (value.status === "unavailable") return "unavailable";
  if (value.status === "stale") return "stale";
  return "ok";
}

function isBooleanOn(value: RWValue): boolean {
  return value.type === "bool" && value.status === "ok" && value.v === true;
}

function isBooleanOff(value: RWValue): boolean {
  return value.type === "bool" && value.status === "ok" && value.v === false;
}

function EdgeValueBadge({ value }: { value: RWValue }) {
  const formatted = formatValue(value);
  const swatch = value.status === "ok" && value.type === "color" ? String(value.v) : null;
  const boolTone = value.status === "ok" && value.type === "bool" ? (value.v ? "bool-true" : "bool-false") : "";
  return (
    <span className={`rw-edge-value ${edgeStatus(value)} ${boolTone}`}>
      {swatch && <span className="rw-edge-swatch" style={{ background: swatch }} />}
      {value.type === "bool" && value.status === "ok" && <span className={`rw-edge-bool ${value.v ? "on" : "off"}`} />}
      {formatted.text}
    </span>
  );
}

export function RWEdge({
  id,
  source,
  target,
  sourceHandleId,
  targetHandleId,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
  interactionWidth,
  selected,
}: EdgeProps<RWEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  // While a new connection is being dragged onto this edge's own input pin, this wire is the one the
  // single-source rule will drop on drop. Signal that by rendering it destructive so the user sees
  // what they are about to replace. The selector returns a bare boolean, so only this wire (and the
  // previously-doomed one) re-render as the hover moves, not every edge on each pointer move.
  const doomed = useConnection((conn) => {
    if (!conn.inProgress || conn.isValid === false || !conn.toHandle) return false;
    // The connection can be dragged from either side; its input end is whichever handle is a target.
    const input = conn.fromHandle?.type === "target" ? conn.fromHandle : conn.toHandle.type === "target" ? conn.toHandle : null;
    const output = conn.fromHandle?.type === "source" ? conn.fromHandle : conn.toHandle.type === "source" ? conn.toHandle : null;
    if (!input || !output) return false;
    if (input.nodeId !== target || (input.id ?? null) !== (targetHandleId ?? null)) return false;
    // Dragging this very wire back onto its own input replaces nothing.
    return !(output.nodeId === source && (output.id ?? null) === (sourceHandleId ?? null));
  });
  const valueType = data?.valueType ?? data?.value?.type ?? "any";
  const value = data?.value ?? UN(valueType);
  const status = edgeStatus(value);
  const active = isBooleanOn(value);
  const off = isBooleanOff(value);
  const wireBase = TYPE_VAR[value.type];
  const wireColor = status === "error" ? "var(--rw-h-error)" : off ? `color-mix(in oklab, ${wireBase} 58%, var(--rw-line) 42%)` : wireBase;
  const style = { "--wire": wireColor } as CSSProperties;
  const pathStyle = doomed
    ? ({
        ...style,
        stroke: "var(--rw-h-error)",
        strokeWidth: 3.6,
        opacity: 0.95,
        strokeDasharray: "7 5",
        filter: "drop-shadow(0 0 5px color-mix(in oklab, var(--rw-h-error) 60%, transparent))",
      } as CSSProperties)
    : ({
        ...style,
        stroke: wireColor,
        strokeWidth: selected ? 4.2 : active ? 3.8 : off ? 3.25 : 3.5,
        opacity: status === "unavailable" ? 0.36 : status === "stale" ? 0.56 : off ? 0.86 : 1,
        strokeDasharray: status === "error" ? "8 5" : status === "unavailable" ? "3 8" : status === "stale" ? "12 7" : undefined,
        filter: selected
          ? "drop-shadow(0 0 4px color-mix(in oklab, var(--rw-accent) 70%, transparent))"
          : status === "error"
            ? "drop-shadow(0 0 4px color-mix(in oklab, var(--rw-h-error) 55%, transparent))"
            : status === "ok"
              ? active
                ? "drop-shadow(0 0 4px color-mix(in oklab, var(--wire) 54%, transparent)) drop-shadow(0 0 9px color-mix(in oklab, var(--wire) 24%, transparent))"
                : off
                  ? "drop-shadow(0 0 1px color-mix(in oklab, var(--wire) 16%, transparent))"
                  : "drop-shadow(0 0 2px color-mix(in oklab, var(--wire) 26%, transparent))"
              : "none",
      } as CSSProperties);

  return (
    <>
      <path className="rw-edge-halo" d={edgePath} style={style} />
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 20}
        className={`rw-edge-main ${status} ${active ? "bool-on" : off ? "bool-off" : ""} ${doomed ? "doomed" : ""}`}
        style={pathStyle}
      />
      {active && <path className="rw-edge-flow" d={edgePath} pathLength={1} style={style} />}
      <EdgeLabelRenderer>
        <div
          className="rw-edge-label nodrag nopan"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            ...style,
          }}
        >
          <EdgeValueBadge value={value} />
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
