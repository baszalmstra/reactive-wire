import type { RuntimeNode, RuntimePin } from "./runtime-types.js";

export type IconName =
  | "sun" | "motion" | "bulb" | "and" | "cmp" | "const"
  | "mem" | "sel" | "io-in" | "io-out" | "macro" | "menu" | "ha"
  // Device-class glyphs shown next to an entity's value.
  | "occupancy" | "door" | "window" | "temperature" | "humidity"
  | "power" | "energy" | "battery" | "timestamp" | "duration"
  | "illuminance" | "pressure" | "connectivity";

/** Editor pin name retained for compatibility; its semantics are the shared runtime pin. */
export interface PinDef extends RuntimePin {}

export type Health = "ok" | "warn" | "error";

/** Canvas-only presentation attached to a runtime node in the persisted editor document. */
export interface NodeViewState {
  title: string;
  subtitle: string;
  icon: IconName;
  x: number;
  y: number;
  w?: number;
  bodyExtra?: number;
  /** An inline body widget below the pins. */
  widget?: "color" | "sink";
}

/** Persisted/editor node: runtime semantics composed with canvas-only view state. */
export interface NodeData extends RuntimeNode, NodeViewState {
  inputs: PinDef[];
  outputs: PinDef[];
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
