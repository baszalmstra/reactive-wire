import { useMemo } from "react";
import { TYPE_VAR } from "../../../shared/theme.js";
import { formatValue, type RWValue } from "../../../shared/value.js";

/** One observed sample: the value and when it was seen. */
export interface Sample {
  value: RWValue;
  t: number;
}

const WIDTH = 200;
const HEIGHT = 56;
const TOP = 6;
const BOTTOM = 50;

/** Pulls the plottable number out of a sample, or null for booleans/absent/error/non-numeric. */
function plotNumber(s: Sample): number | null {
  const v = s.value;
  if (v.status === "error" || v.status === "unavailable") return null;
  if (v.type === "num" && typeof v.v === "number" && Number.isFinite(v.v)) return v.v;
  if (v.type === "bool") return v.v === true ? 1 : 0;
  return null;
}

/**
 * A tiny chart of a pin's recent value history. Numeric pins (and booleans, drawn as a
 * 0/1 step line) get a real sparkline; everything else falls back to a textual recent-values
 * strip. Absent and error samples leave gaps in the line rather than reading as zero.
 * Stale (last-known, feed-down) samples carry their last numeric value and plot the same as
 * live ones, so a flat tail can be either a steady value or a stale one.
 */
export function Sparkline({ history }: { history: Sample[] }) {
  const numeric = useMemo(() => history.some((s) => s.value.type === "num"), [history]);
  const boolean = useMemo(() => !numeric && history.some((s) => s.value.type === "bool"), [numeric, history]);

  const plot = useMemo(() => {
    if (!numeric && !boolean) return null;
    const nums = history.map(plotNumber);
    const present = nums.filter((n): n is number => n !== null);
    if (present.length < 2) return null;
    let min = Math.min(...present);
    let max = Math.max(...present);
    if (boolean) {
      min = 0;
      max = 1;
    }
    const span = max - min || 1;
    const n = history.length;
    // Map each sample to a coordinate; absent/error samples break the line into segments.
    const xy = nums.map((v, i) => {
      if (v === null) return null;
      const x = n === 1 ? 0 : (i / (n - 1)) * WIDTH;
      const y = BOTTOM - ((v - min) / span) * (BOTTOM - TOP);
      return { x, y };
    });
    // Booleans hold their value until the next sample, so draw a step line: a corner point at
    // the new sample's x but the previous y turns each change into a horizontal-then-vertical jump.
    const segments: string[] = [];
    let run: string[] = [];
    let prev: { x: number; y: number } | null = null;
    for (const p of xy) {
      if (p === null) {
        if (run.length) segments.push(run.join(" "));
        run = [];
        prev = null;
      } else {
        if (boolean && prev && p.y !== prev.y) run.push(`${p.x.toFixed(1)},${prev.y.toFixed(1)}`);
        run.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
        prev = p;
      }
    }
    if (run.length) segments.push(run.join(" "));
    const last = present[present.length - 1];
    const lastXY = [...xy].reverse().find((p): p is { x: number; y: number } => p !== null) ?? null;
    return { min, max, segments, last, lastXY };
  }, [history, numeric, boolean]);

  // Numeric / boolean sparkline.
  if (plot) {
    const color = numeric ? TYPE_VAR.num : TYPE_VAR.bool;
    return (
      <div className="relative rounded-[7px] border border-rw-line bg-rw-panel2 px-2 pt-2 pb-1">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block w-full h-[56px]">
          <line x1={0} y1={BOTTOM} x2={WIDTH} y2={BOTTOM} stroke="var(--rw-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {plot.segments.map((pts, i) => (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={color}
              strokeWidth={1.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {plot.lastXY && (
            <circle cx={plot.lastXY.x} cy={plot.lastXY.y} r={2.4} fill={color} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <div className="flex justify-between text-[9px] font-mono text-rw-faint pt-0.5">
          <span>{round(plot.max)}</span>
          <span>{round(plot.min)}</span>
        </div>
      </div>
    );
  }

  // Empty / sampling state.
  if (history.length < 2) {
    return (
      <div className="relative rounded-[7px] border border-rw-line bg-rw-panel2 px-2 pt-2 pb-1">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block w-full h-[56px]">
          <line x1={0} y1={BOTTOM - 10} x2={WIDTH} y2={BOTTOM - 10} stroke="var(--rw-line)" strokeWidth={1} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="text-[9px] text-rw-faint pt-0.5">value history — sampling…</div>
      </div>
    );
  }

  // Non-numeric fallback: a strip of the most recent values.
  const recent = history.slice(-6);
  return (
    <div className="rounded-[7px] border border-rw-line bg-rw-panel2 px-2 py-1.5 flex flex-wrap items-center gap-1">
      {recent.map((s, i) => {
        const f = formatValue(s.value);
        const muted = f.kind === "error" || f.kind === "unavail" || f.kind === "none";
        return (
          <span
            key={i}
            className={
              "font-mono text-[10px] px-1.5 py-0.5 rounded-[4px] border-[0.5px] " +
              (muted
                ? "text-rw-faint border-dashed border-rw-line"
                : "text-rw-dim border-rw-line bg-rw-panel " + (i === recent.length - 1 ? "text-rw-text" : ""))
            }
          >
            {f.kind === "error" ? "error" : f.kind === "unavail" ? "—" : f.text}
          </span>
        );
      })}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
