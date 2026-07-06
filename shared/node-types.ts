import type { ValueType } from "./theme.js";

export type IconName =
  | "sun" | "motion" | "bulb" | "and" | "cmp" | "const"
  | "mem" | "sel" | "io-in" | "io-out" | "macro" | "menu" | "ha"
  // Device-class glyphs shown next to an entity's value.
  | "occupancy" | "door" | "window" | "temperature" | "humidity"
  | "power" | "energy" | "battery" | "timestamp" | "duration"
  | "illuminance" | "pressure" | "connectivity";

export interface PinDef {
  id: string;
  label: string;
  type: ValueType;
  unit?: string;
  variadic?: boolean;
  ghost?: boolean;
  missing?: string;
  /** This pin has an editable literal value (an input default, or a constant output). */
  editable?: boolean;
}

export type Health = "ok" | "warn" | "error";

export interface NodeData {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  icon: IconName;
  x: number;
  y: number;
  w?: number;
  inputs: PinDef[];
  outputs: PinDef[];
  stateful?: boolean;
  config?: Record<string, unknown>;
  bodyExtra?: number;
  /** An inline body widget below the pins. */
  widget?: "color" | "sink";
  /** Literal values for editable pins, keyed by pin id (input defaults / constant outputs). */
  values?: Record<string, unknown>;
  /** Generic pins (type "any") that resolve to one shared type, e.g. compare's [a, b]. */
  typeGroup?: string[];
}

const HEADER_H = 40;
const PAD_T = 10;
const ROW = 28;
const PAD_B = 12;

/** Node width and height, and the vertical centre of each pin row. */
export function nodeGeom(n: NodeData) {
  const w = n.w ?? 210;
  const rows = Math.max(n.inputs.length, n.outputs.length);
  const extra = n.bodyExtra ?? 0;
  const h = HEADER_H + PAD_T + rows * ROW + extra + PAD_B;
  const cy = (i: number) => HEADER_H + PAD_T + ROW * i + ROW / 2;
  return {
    w,
    h,
    rows,
    inputs: n.inputs.map((p, i) => ({ ...p, cx: 0, cy: cy(i) })),
    outputs: n.outputs.map((p, i) => ({ ...p, cx: w, cy: cy(i) })),
  };
}
