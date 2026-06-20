import type { CSSProperties, PointerEvent } from "react";
import { TYPE_VAR } from "../../../shared/theme.js";
import type { PinDef } from "../../../shared/node-types.js";
import type { RWValue } from "../../../shared/value.js";
import { cn } from "../cn.js";
import { ValueChip, type Anatomy } from "./ValueChip.js";

export type PinShape = "round" | "square" | "tab";
export type PinSide = "in" | "out";

export interface PinProps {
  side: PinSide;
  pin: PinDef;
  nodeId: string;
  value?: RWValue | null;
  anatomy?: Anatomy;
  pinShape?: PinShape;
  hot?: boolean;
  onPinDown?: (e: PointerEvent, side: PinSide, pinId: string) => void;
  onPinUp?: (e: PointerEvent, side: PinSide, pinId: string) => void;
}

const GHOST_TAG =
  "font-mono text-[9px] text-rw-error px-[5px] py-px rounded-[4px] whitespace-nowrap border border-dashed bg-[color-mix(in_oklab,var(--rw-h-error)_14%,transparent)] border-[color-mix(in_oklab,var(--rw-h-error)_45%,transparent)]";

/** A typed connection point: a color-coded knob plus a label, and (for outputs) a value chip. */
export function Pin({ side, pin, nodeId, value, anatomy, pinShape = "round", hot, onPinDown, onPinUp }: PinProps) {
  const ghost = pin.ghost;
  const tc = ghost ? "var(--rw-h-error)" : TYPE_VAR[pin.type];
  const isAny = pin.type === "any" && !ghost;
  const style: CSSProperties = { ["--tc" as string]: tc };

  const knob = (
    <span
      style={style}
      data-side={side}
      data-node={nodeId}
      data-pin={pin.id}
      onPointerDown={(e) => onPinDown?.(e, side, pin.id)}
      onPointerUp={(e) => onPinUp?.(e, side, pin.id)}
      className={cn(
        "absolute w-[11px] h-[11px] rounded-full z-[3] cursor-crosshair border-[2.5px] border-rw-node bg-[var(--tc)] shadow-[0_0_0_1px_var(--tc)]",
        side === "in" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        pinShape === "square" && "!rounded-[2px]",
        pinShape === "tab" && "!rounded-[2px] w-2 h-[14px]",
        isAny && "!bg-rw-canvas border-2 border-dashed border-rw-any !shadow-none",
        ghost && "!bg-rw-canvas border-2 border-dashed border-rw-error !shadow-none",
        hot && "!shadow-[0_0_0_1px_var(--tc),0_0_0_6px_color-mix(in_oklab,var(--tc)_38%,transparent)]",
        "hover:shadow-[0_0_0_1px_var(--tc),0_0_0_5px_color-mix(in_oklab,var(--tc)_28%,transparent)]",
      )}
    />
  );

  if (side === "in") {
    return (
      <div className="relative flex items-center h-7 pl-[15px] gap-[7px]">
        {knob}
        <span className={cn("text-[11px] whitespace-nowrap", ghost ? "text-rw-error" : "text-rw-dim")}>
          {pin.variadic ? <span className="text-rw-faint italic text-[10.5px]">+ add input</span> : pin.label}
        </span>
        {ghost && (
          <span className={GHOST_TAG} title="The wire references an attribute that no longer exists">
            missing: {pin.missing}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-end h-7 pr-[15px] gap-[7px]">
      <span className={cn("text-[11px] whitespace-nowrap", ghost ? "text-rw-error" : "text-rw-dim")}>
        {ghost ? <span className={GHOST_TAG}>missing: {pin.missing}</span> : pin.label}
      </span>
      <ValueChip value={value} unit={pin.unit} anatomy={anatomy} />
      {knob}
    </div>
  );
}
