import type { HAConnectionPhase } from "../../../shared/ha-status.js";
import { cn } from "../cn.js";

export type StatusKind = "offline" | "paused" | "live" | "draft";

const STYLES: Record<StatusKind, string> = {
  offline:
    "text-rw-warn border-[color-mix(in_oklab,var(--rw-h-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--rw-h-warn)_10%,transparent)]",
  paused:
    "text-rw-warn border-[color-mix(in_oklab,var(--rw-h-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--rw-h-warn)_10%,transparent)]",
  live: "text-rw-ok border-[color-mix(in_oklab,var(--rw-h-ok)_45%,transparent)] bg-[color-mix(in_oklab,var(--rw-h-ok)_12%,transparent)]",
  draft:
    "text-rw-dim border-rw-line bg-rw-panel2",
};

const LABEL: Record<StatusKind, string> = { offline: "DISCONNECTED", paused: "PAUSED", live: "LIVE", draft: "DRAFT" };

/**
 * The editor's deploy/feed state: disconnected (live server state unknown), live, or draft.
 * The sub line explains which case applies.
 */
export function StatusPill({ kind, sub }: { kind: StatusKind; sub?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={sub}
      className={cn(
        "flex items-center gap-[7px] h-[30px] px-3 rounded-lg border font-bold text-[11px] tracking-[.06em]",
        STYLES[kind],
      )}
    >
      <span
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          kind === "offline" || kind === "paused" ? "bg-rw-warn-fill" : kind === "live" ? "rw-live-dot bg-rw-ok-fill [animation:rw-blink_1.8s_ease-in-out_infinite]" : "bg-rw-faint",
        )}
      />
      <span className="flex flex-col items-start leading-[1.05]">
        {LABEL[kind]}
        {sub && <span className="text-[8.5px] font-medium tracking-[.02em] normal-case">{sub}</span>}
      </span>
    </div>
  );
}

/** Picks the status state from connection + deploy flags. */
export function deriveStatus(connected: boolean, actuating: boolean, dirty: boolean, haPhase: HAConnectionPhase = "ready"): { kind: StatusKind; sub: string } {
  if (!connected) return { kind: "offline", sub: "state unknown" };
  if (haPhase !== "ready") return { kind: "paused", sub: haPhase === "syncing" ? "HA syncing" : "HA disconnected" };
  if (actuating) return { kind: "live", sub: dirty ? "auto-deploy" : "in sync" };
  return { kind: "draft", sub: dirty ? "undeployed changes" : "not deployed" };
}
