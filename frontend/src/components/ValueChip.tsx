import type { CSSProperties } from "react";
import { TYPE_VAR } from "../../../shared/theme.js";
import { formatValue, type RWValue } from "../../../shared/value.js";
import { cn } from "../cn.js";

export type Anatomy = "chips" | "inset" | "minimal";

const BASE = "inline-flex items-center gap-1 font-mono text-[10px] leading-[1.25] whitespace-nowrap rounded-[5px]";
const TINTED =
  "px-1.5 py-0.5 text-[var(--tc)] bg-[color-mix(in_oklab,var(--tc)_15%,transparent)] border-[0.5px] border-[color-mix(in_oklab,var(--tc)_32%,transparent)]";
const ERR =
  "px-1.5 py-0.5 text-rw-error bg-[color-mix(in_oklab,var(--rw-h-error)_16%,transparent)] border-[0.5px] border-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)]";
const EMPTY = "px-1.5 py-0.5 text-rw-faint border-[0.5px] border-dashed border-rw-line";

const ANATOMY: Record<Anatomy, string> = {
  chips: "",
  inset: "!px-0 !py-0.5 !bg-transparent !border-transparent text-[11px]",
  minimal: "!p-0 !bg-transparent !border-transparent !text-rw-dim",
};

/** An always-on display of a pin's current value. Absence and error read distinctly. */
export function ValueChip({
  value,
  unit,
  anatomy = "chips",
  timeZone,
}: {
  value: RWValue | null | undefined;
  unit?: string;
  anatomy?: Anatomy;
  timeZone?: string;
}) {
  const f = formatValue(value, timeZone);
  const isTyped = value && (value.status === "ok" || value.status === "stale");
  const typeColor = isTyped ? TYPE_VAR[value.type] : undefined;
  const kindClass = f.kind === "error" ? ERR : f.kind === "unavail" || f.kind === "none" ? EMPTY : TINTED;
  const cls = cn(BASE, kindClass, ANATOMY[anatomy], f.stale && "border-dashed");
  const style: CSSProperties = { ["--tc" as string]: typeColor };

  if (f.kind === "error") {
    return (
      <span className={cls}>
        <span className="text-[9px]">⚠</span>error
      </span>
    );
  }
  if (f.kind === "unavail") return <span className={cls}>—&nbsp;unavailable</span>;
  if (f.kind === "none") return <span className={cls}>—</span>;

  if (f.kind === "bool") {
    return (
      <span className={cls} style={style}>
        <span
          className={cn(
            "w-[7px] h-[7px] rounded-full border-[1.5px] border-[var(--tc)] box-border shrink-0",
            f.bool && "bg-[var(--tc)]",
          )}
        />
        {f.text}
      </span>
    );
  }
  if (f.kind === "color") {
    return (
      <span className={cls} style={style}>
        <span
          className="w-[11px] h-[11px] rounded-[3px] shrink-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,.2),0_0_0_1px_rgba(0,0,0,.3)]"
          style={{ background: f.swatch }}
        />
        {f.text}
      </span>
    );
  }
  return (
    <span className={cls} style={style}>
      {f.text}
      {unit && f.kind === "num" ? <span className="ml-px text-rw-faint">{unit}</span> : null}
    </span>
  );
}
