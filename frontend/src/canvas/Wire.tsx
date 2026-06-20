import type { CSSProperties } from "react";

export interface WireProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dead?: boolean;
  error?: boolean;
}

/** A type-colored connection between two pins, with a flowing pulse to convey "live". */
export function Wire({ x1, y1, x2, y2, color, dead, error }: WireProps) {
  const c = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const d = `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
  const stroke = error ? "var(--rw-h-error)" : color;
  const base: CSSProperties = {
    fill: "none",
    stroke,
    strokeWidth: 2.2,
    strokeLinecap: "round",
    opacity: dead ? 0.5 : 0.92,
    strokeDasharray: dead || error ? "5 6" : undefined,
  };
  const flow: CSSProperties = {
    fill: "none",
    stroke,
    strokeWidth: 2.6,
    strokeLinecap: "round",
    strokeDasharray: "1.5 13",
    opacity: 0.95,
    animation: "rw-dash 1.1s linear infinite",
  };
  return (
    <g>
      <path d={d} style={base} />
      {!dead && !error && <path d={d} style={flow} />}
    </g>
  );
}
