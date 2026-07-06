import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { UN, formatValue, type RWValue, type Status } from "../../../shared/value.js";
import type { EvalResults } from "../../../shared/results.js";
import type { RWNodeType } from "./validation.js";

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

export function withRWEdgeData(edges: Edge[], nodes: RWNodeType[], results: EvalResults): RWEdgeType[] {
  return edges.map((edge) => {
    const fallbackType = sourcePinType(nodes, edge);
    const value = edge.sourceHandle ? results.outputs[`${edge.source}:${edge.sourceHandle}`] ?? null : null;
    const valueType = value?.type ?? fallbackType;
    return {
      ...edge,
      type: "rw",
      animated: false,
      data: {
        ...edge.data,
        valueType,
        value,
      },
    };
  });
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

function EdgeValueBadge({ value }: { value: RWValue }) {
  const formatted = formatValue(value);
  const swatch = value.status === "ok" && value.type === "color" ? String(value.v) : null;
  return (
    <span className={`rw-edge-value ${edgeStatus(value)}`}>
      {swatch && <span className="rw-edge-swatch" style={{ background: swatch }} />}
      {value.type === "bool" && value.status === "ok" && <span className={`rw-edge-bool ${value.v ? "on" : "off"}`} />}
      {formatted.text}
    </span>
  );
}

export function RWEdge({
  id,
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
  const valueType = data?.valueType ?? data?.value?.type ?? "any";
  const value = data?.value ?? UN(valueType);
  const status = edgeStatus(value);
  const wireColor = status === "error" ? "var(--rw-h-error)" : TYPE_VAR[value.type];
  const style = { "--wire": wireColor } as CSSProperties;
  const active = isBooleanOn(value);
  const pathStyle = {
    ...style,
    stroke: wireColor,
    strokeWidth: selected ? 4.2 : active ? 3.6 : 3.5,
    opacity: status === "unavailable" ? 0.36 : status === "stale" ? 0.56 : 1,
    strokeDasharray: status === "error" ? "8 5" : status === "unavailable" ? "3 8" : status === "stale" ? "12 7" : undefined,
    filter: selected
      ? "drop-shadow(0 0 4px color-mix(in oklab, var(--rw-accent) 70%, transparent))"
      : status === "error"
        ? "drop-shadow(0 0 4px color-mix(in oklab, var(--rw-h-error) 55%, transparent))"
        : status === "ok"
          ? active
            ? "drop-shadow(0 0 3px color-mix(in oklab, var(--wire) 32%, transparent))"
            : "drop-shadow(0 0 2px color-mix(in oklab, var(--wire) 26%, transparent))"
          : "none",
  } as CSSProperties;

  return (
    <>
      <path className="rw-edge-halo" d={edgePath} style={style} />
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={interactionWidth ?? 20}
        className={`rw-edge-main ${status} ${active ? "bool-on" : ""}`}
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
