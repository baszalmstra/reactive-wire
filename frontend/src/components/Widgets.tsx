import type { PointerEvent } from "react";
import type { SinkAction } from "../../../shared/results.js";
import { TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { cn } from "../cn.js";

export const COLOR_PRESETS = ["#ff3b30", "#ff9f0a", "#ffd60a", "#34c759", "#0a84ff", "#bf5af2", "#ffffff", "#1c1c1e"];

const INPUT =
  "nodrag h-[28px] px-2 rounded-[6px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[11.5px] outline-none w-full focus:border-rw-accent";
const SEL = "nodrag h-[28px] px-1.5 rounded-[6px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[11.5px] outline-none focus:border-rw-accent";

const stop = (e: PointerEvent) => e.stopPropagation();

/** Edits a single pin's literal value, with a control matching the pin's type. */
export function PinValueEditor({
  value,
  type,
  onChange,
  compact,
}: {
  value: unknown;
  type: string;
  onChange: (v: unknown) => void;
  /** Tight layout for inline-on-pin use: color shows only the swatch (no preset row). */
  compact?: boolean;
}) {
  // Outline each editor in its value type's color, matching the pins and wires.
  const tc = TYPE_VAR[type as ValueType] ?? "var(--rw-t-any)";
  if (type === "bool") {
    const on = value === true || value === "true";
    return (
      <button
        onClick={() => onChange(!on)}
        onPointerDown={stop}
        title={on ? "true" : "false"}
        style={{ borderColor: tc }}
        className={cn("nodrag relative w-[30px] h-[18px] rounded-full border transition-colors shrink-0", on ? "bg-rw-accent" : "bg-rw-line")}
      >
        <span className={cn("absolute top-[2px] left-[2px] w-[12px] h-[12px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.3)] transition-transform", on && "translate-x-[12px]")} />
      </button>
    );
  }
  if (type === "num") {
    return (
      <input
        type="number"
        value={Number(value ?? 0)}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={stop}
        style={{ borderColor: tc }}
        className={cn(INPUT, "rw-num")}
      />
    );
  }
  if (type === "color") {
    const hex = typeof value === "string" ? value : "#ff3b30";
    const swatch = (
      <div className="relative w-7 h-7 rounded-[6px] overflow-hidden border shrink-0" style={{ background: hex, borderColor: tc }} onPointerDown={stop}>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="nodrag absolute -inset-[20%] w-[140%] h-[140%] opacity-0 cursor-pointer" />
      </div>
    );
    if (compact) return swatch;
    return (
      <div className="flex items-center gap-[9px]" onPointerDown={stop}>
        {swatch}
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button key={c} style={{ background: c }} onClick={() => onChange(c)} className="nodrag w-[14px] h-[14px] rounded-full border border-rw-line" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} onPointerDown={stop} style={{ borderColor: tc }} className={INPUT} />
  );
}

const COMPARE_OPS_BY_TYPE: Record<string, string[]> = {
  num: ["<", ">", "<=", ">=", "==", "!="],
  duration: ["<", ">", "<=", ">=", "==", "!="],
  datetime: ["<", ">", "<=", ">=", "==", "!="],
  str: ["==", "!=", "<", ">"],
  bool: ["==", "!="],
  color: ["==", "!="],
  any: ["==", "!="],
};

/** Operator dropdown for a compare node; the option set narrows to the resolved type. */
export function OpSelect({ value, type, onChange }: { value: string; type: string; onChange: (v: string) => void }) {
  const base = COMPARE_OPS_BY_TYPE[type] ?? COMPARE_OPS_BY_TYPE.any!;
  const ops = base.includes(value) ? base : [value, ...base];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop} className={SEL}>
      {ops.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

const DURATION_UNITS: Array<{ value: string; label: string }> = [
  { value: "ms", label: "milliseconds" },
  { value: "sec", label: "seconds" },
  { value: "min", label: "minutes" },
  { value: "hr", label: "hours" },
];

/** Unit dropdown for the Duration constructor node (ms / sec / min / hr). */
export function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop} className={SEL}>
      {DURATION_UNITS.map((u) => (
        <option key={u.value} value={u.value}>{u.label}</option>
      ))}
    </select>
  );
}

const SHIFT_DIRS: Array<{ value: string; label: string }> = [
  { value: "plus", label: "plus (+)" },
  { value: "minus", label: "minus (−)" },
];

/** Direction dropdown for the datetime shift node (add or subtract the Duration). */
export function DirSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} onPointerDown={stop} className={SEL}>
      {SHIFT_DIRS.map((d) => (
        <option key={d.value} value={d.value}>{d.label}</option>
      ))}
    </select>
  );
}

/** A reconciling sink's status: dry-run preview of the call it would make, or live actuation. */
export function SinkPanel({ action, actuating }: { action?: SinkAction; actuating?: boolean }) {
  if (!action) return null;
  const err = action.status === "error" || action.status === "unavailable";
  return (
    <div
      className={cn(
        "mx-3 mt-[9px] rounded-lg px-[10px] py-2 border font-mono",
        actuating
          ? "border-[color-mix(in_oklab,var(--rw-h-ok)_45%,transparent)] bg-[color-mix(in_oklab,var(--rw-h-ok)_9%,var(--rw-panel2))]"
          : "border-dashed border-rw-line bg-rw-panel2",
        err && "!border-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)]",
      )}
    >
      <div className="flex items-center gap-[7px] mb-[5px]">
        <span
          className={cn(
            "text-[8.5px] font-bold tracking-[.05em] uppercase px-1.5 py-0.5 rounded-[4px]",
            actuating ? "text-rw-ok bg-[color-mix(in_oklab,var(--rw-h-ok)_22%,transparent)]" : "text-rw-warn bg-[color-mix(in_oklab,var(--rw-h-warn)_22%,transparent)]",
          )}
        >
          {actuating ? "● live" : "dry-run"}
        </span>
        <span className="text-[9px] text-rw-faint uppercase tracking-[.05em]">{actuating ? "calling" : "would call"}</span>
      </div>
      <div className={cn("text-[10.5px] break-words", err ? "text-rw-error" : "text-rw-text")}>{action.call ?? action.note}</div>
    </div>
  );
}
