import { useState, type PointerEvent } from "react";
import type { SinkAction } from "../../../shared/results.js";
import { TYPE_VAR, type ValueType } from "../../../shared/theme.js";
import { cn } from "../cn.js";

const DEFAULT_COLOR = "#ffffff";

export const COLOR_PRESETS = [DEFAULT_COLOR, "#ffd60a", "#ff9f0a", "#ff3b30", "#34c759", "#0a84ff", "#bf5af2", "#64d2ff"];

const INPUT =
  "nodrag h-[28px] px-2 rounded-[6px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[11.5px] outline-none w-full focus:border-rw-accent";
const SEL = "nodrag h-[28px] px-1.5 rounded-[6px] border border-rw-line bg-rw-panel2 text-rw-text font-mono text-[11.5px] outline-none focus:border-rw-accent";

const stop = (e: PointerEvent) => e.stopPropagation();

function SetValueButton({ compact, label, onClick }: { compact?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={stop}
      className={cn(
        "nodrag inline-flex items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-rw-line bg-rw-panel2 text-rw-faint hover:text-rw-text hover:border-rw-accent transition-colors",
        compact ? "h-6 px-2 text-[10px]" : "h-7 px-2.5 text-[11px] w-full",
      )}
    >
      <span className="text-rw-accent">+</span>
      <span>{label}</span>
    </button>
  );
}

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
  const [editingEmpty, setEditingEmpty] = useState(false);
  // Outline each editor in its value type's color, matching the pins and wires.
  const tc = TYPE_VAR[type as ValueType] ?? "var(--rw-t-any)";
  const unset = value === undefined || value === null;

  if (type === "bool") {
    const on = value === true || value === "true";
    const options = compact
      ? [
          { label: "—", title: "Not set", value: undefined },
          { label: "off", title: "Explicit false", value: false },
          { label: "on", title: "Explicit true", value: true },
        ]
      : [
          { label: "Not set", title: "Leave this pin unset", value: undefined },
          { label: "Off", title: "Set false", value: false },
          { label: "On", title: "Set true", value: true },
        ];
    return (
      <div
        className={cn(
          "nodrag inline-flex items-center overflow-hidden rounded-[7px] border border-rw-line bg-rw-panel2",
          compact ? "h-6 text-[9.5px]" : "h-7 text-[11px] w-full",
        )}
        style={{ borderColor: tc }}
        onPointerDown={stop}
      >
        {options.map((opt) => {
          const active = opt.value === undefined ? unset : opt.value === on && !unset;
          return (
            <button
              key={String(opt.label)}
              type="button"
              title={opt.title}
              onClick={() => onChange(opt.value)}
              className={cn(
                "h-full px-2 border-r border-rw-line last:border-r-0 transition-colors",
                compact ? "min-w-[28px]" : "flex-1",
                active ? "bg-rw-accent text-white" : "text-rw-faint hover:text-rw-text hover:bg-rw-node-hdr",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (type === "num") {
    const n = Number(value);
    const numberUnset = unset || value === "" || !Number.isFinite(n);
    const numberText = numberUnset ? "" : String(n);
    if (numberUnset && !editingEmpty) {
      return <SetValueButton compact={compact} label={compact ? "set" : "Set value"} onClick={() => setEditingEmpty(true)} />;
    }
    return (
      <input
        autoFocus={editingEmpty}
        type="number"
        value={numberText}
        placeholder="Optional"
        onBlur={() => {
          if (numberUnset) setEditingEmpty(false);
        }}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        onPointerDown={stop}
        style={{ borderColor: tc }}
        className={cn(INPUT, "rw-num")}
      />
    );
  }

  if (type === "color") {
    const colorUnset = typeof value !== "string";
    const hex = typeof value === "string" ? value : DEFAULT_COLOR;
    const picker = (
      <label
        className={cn(
          "nodrag inline-flex items-center gap-2 rounded-[7px] border bg-rw-panel2 cursor-pointer text-rw-faint hover:text-rw-text hover:border-rw-accent transition-colors",
          compact ? "h-7 px-2 text-[10px]" : "h-7 px-2.5 text-[11px]",
          colorUnset && "border-dashed",
        )}
        style={{ borderColor: tc }}
        title={colorUnset ? "Not set — choose a color" : hex}
        onPointerDown={stop}
      >
        <span
          className="w-4 h-4 rounded-[4px] border border-rw-line shrink-0"
          style={{ background: colorUnset ? DEFAULT_COLOR : hex }}
        />
        <span>{colorUnset ? (compact ? "color" : "Choose color") : compact ? "" : hex.toUpperCase()}</span>
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="sr-only" />
      </label>
    );
    if (compact) return picker;
    return (
      <div className="flex items-center gap-[9px]" onPointerDown={stop}>
        {picker}
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button key={c} style={{ background: c }} onClick={() => onChange(c)} className="nodrag w-[14px] h-[14px] rounded-full border border-rw-line" />
          ))}
        </div>
        {!colorUnset && (
          <button type="button" onClick={() => onChange(undefined)} className="nodrag text-[10px] text-rw-faint hover:text-rw-text">
            Clear
          </button>
        )}
      </div>
    );
  }

  if (unset && !editingEmpty) {
    return <SetValueButton compact={compact} label={compact ? "set" : "Set text"} onClick={() => setEditingEmpty(true)} />;
  }
  return (
    <input
      autoFocus={editingEmpty}
      value={String(value ?? "")}
      placeholder="Optional"
      onBlur={() => {
        if (unset) setEditingEmpty(false);
      }}
      onChange={(e) => onChange(e.target.value)}
      onPointerDown={stop}
      style={{ borderColor: tc }}
      className={INPUT}
    />
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
