import type { CSSProperties } from "react";
import { Icon } from "./Icon.js";
import { cn } from "../cn.js";
import type { Health } from "../../../shared/node-types.js";

const HEALTH_VAR: Record<Health, string> = {
  ok: "var(--rw-h-ok)",
  warn: "var(--rw-h-warn)",
  error: "var(--rw-h-error)",
};

/** A node's health indicator: a colored dot, or a larger red badge with "!" for errors. */
export function HealthDot({ health }: { health: Health }) {
  const style: CSSProperties = { ["--hc" as string]: HEALTH_VAR[health] };
  return (
    <span
      title={`health: ${health}`}
      style={style}
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0 bg-[var(--hc)]",
        "shadow-[0_0_0_2px_color-mix(in_oklab,var(--hc)_22%,transparent)]",
        health === "error" ? "w-[15px] h-[15px]" : "w-[9px] h-[9px]",
      )}
    >
      {health === "error" && <span className="text-[9px] font-extrabold text-white leading-none">!</span>}
    </span>
  );
}

/** Marks a node that holds internal state. */
export function MemBadge() {
  return (
    <span
      title="Has memory — this node holds internal state"
      className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] shrink-0 text-rw-accent bg-[color-mix(in_oklab,var(--rw-accent)_20%,transparent)]"
    >
      <Icon name="mem" size={11} />
    </span>
  );
}
