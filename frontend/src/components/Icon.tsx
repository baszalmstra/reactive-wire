import type { CSSProperties } from "react";
import type { IconName } from "../../../shared/node-types.js";

/** Minimal geometric line glyphs for node types. */
export function Icon({ name, size = 15 }: { name: IconName | string; size?: number }) {
  const s: CSSProperties = { width: size, height: size, display: "block", flex: "none" };
  const c = "currentColor";
  const common = {
    fill: "none",
    stroke: c,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "menu":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 7h16M4 12h16M4 17h16" {...common} />
        </svg>
      );
    case "ha":
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <path d="M4 11.5 12 5l8 6.5" {...common} />
          <path d="M6.5 10.5V19h11v-8.5" {...common} />
          <path d="M10 19v-5h4v5" {...common} />
          <circle cx="18" cy="6" r="2" fill={c} stroke="none" />
        </svg>
      );
    case "sun":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="12" r="4" {...common} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a} x1={12 + Math.cos(r) * 7} y1={12 + Math.sin(r) * 7}
                x2={12 + Math.cos(r) * 9.5} y2={12 + Math.sin(r) * 9.5} {...common} />
            );
          })}
        </svg>
      );
    case "motion":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="9" cy="12" r="2" {...common} />
          <path d="M14 7a8 8 0 0 1 0 10M17 4.5a12 12 0 0 1 0 15" {...common} />
        </svg>
      );
    case "bulb":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M9 16a6 6 0 1 1 6 0c-.7.5-1 1.2-1 2H10c0-.8-.3-1.5-1-2Z" {...common} />
          <line x1="10" y1="21" x2="14" y2="21" {...common} />
        </svg>
      );
    case "and":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M6 5h6a7 7 0 0 1 0 14H6Z" {...common} />
          <line x1="3" y1="9" x2="6" y2="9" {...common} />
          <line x1="3" y1="15" x2="6" y2="15" {...common} />
          <line x1="20" y1="12" x2="22" y2="12" {...common} />
        </svg>
      );
    case "cmp":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M14 7l-6 5 6 5" {...common} />
        </svg>
      );
    case "const":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <line x1="8" y1="4" x2="6" y2="20" {...common} />
          <line x1="16" y1="4" x2="14" y2="20" {...common} />
          <line x1="4" y1="9" x2="19" y2="9" {...common} />
          <line x1="3" y1="15" x2="18" y2="15" {...common} />
        </svg>
      );
    case "mem":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="6" y="6" width="12" height="12" rx="2" {...common} />
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" {...common} />
          {[9, 12, 15].map((x) => (
            <g key={x}>
              <line x1={x} y1="3" x2={x} y2="6" {...common} />
              <line x1={x} y1="18" x2={x} y2="21" {...common} />
            </g>
          ))}
          {[9, 12, 15].map((y) => (
            <g key={"h" + y}>
              <line x1="3" y1={y} x2="6" y2={y} {...common} />
              <line x1="18" y1={y} x2="21" y2={y} {...common} />
            </g>
          ))}
        </svg>
      );
    case "sel":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M5 6h4l5 6 5 0M5 18h4l3-3.6" {...common} />
          <circle cx="20" cy="12" r="1.4" fill={c} stroke="none" />
        </svg>
      );
    case "io-in":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 12h12M11 7l5 5-5 5" {...common} />
          <line x1="20" y1="5" x2="20" y2="19" {...common} />
        </svg>
      );
    case "io-out":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M8 12h12M15 7l5 5-5 5" {...common} />
          <line x1="4" y1="5" x2="4" y2="19" {...common} />
        </svg>
      );
    case "macro":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" {...common} />
          <rect x="13" y="4" width="7" height="7" rx="1.5" {...common} />
          <rect x="4" y="13" width="7" height="7" rx="1.5" {...common} />
          <rect x="13" y="13" width="7" height="7" rx="1.5" {...common} />
        </svg>
      );
    case "occupancy":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="8" r="3" {...common} />
          <path d="M6 19a6 6 0 0 1 12 0" {...common} />
        </svg>
      );
    case "door":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M7 4h10v16H7Z" {...common} />
          <circle cx="14" cy="12" r="1" fill={c} stroke="none" />
        </svg>
      );
    case "window":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="5" y="5" width="14" height="14" rx="1" {...common} />
          <line x1="12" y1="5" x2="12" y2="19" {...common} />
          <line x1="5" y1="12" x2="19" y2="12" {...common} />
        </svg>
      );
    case "temperature":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M10 13V5a2 2 0 0 1 4 0v8a4 4 0 1 1-4 0Z" {...common} />
          <circle cx="12" cy="16" r="1.4" fill={c} stroke="none" />
        </svg>
      );
    case "humidity":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M12 4c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9Z" {...common} />
        </svg>
      );
    case "power":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M13 3l-7 10h5l-1 8 7-10h-5l1-8Z" {...common} />
        </svg>
      );
    case "energy":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M7 4l-2 9h4l-1 7 7-11h-5l2-5Z" {...common} />
          <line x1="17" y1="6" x2="20" y2="6" {...common} />
          <line x1="17" y1="10" x2="20" y2="10" {...common} />
        </svg>
      );
    case "battery":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <rect x="3" y="8" width="16" height="9" rx="1.5" {...common} />
          <line x1="21" y1="11" x2="21" y2="14" {...common} />
          <rect x="5.5" y="10.5" width="6" height="4" rx="0.5" fill={c} stroke="none" />
        </svg>
      );
    case "timestamp":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="12" r="8" {...common} />
          <path d="M12 8v4l3 2" {...common} />
        </svg>
      );
    case "duration":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M7 4h10M7 20h10" {...common} />
          <path d="M8 4c0 4 8 4 8 8s-8 4-8 8" {...common} />
          <path d="M16 4c0 4-8 4-8 8s8 4 8 8" {...common} />
        </svg>
      );
    case "illuminance":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="12" r="3.5" {...common} />
          {[0, 90, 180, 270].map((a) => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a} x1={12 + Math.cos(r) * 6} y1={12 + Math.sin(r) * 6}
                x2={12 + Math.cos(r) * 9} y2={12 + Math.sin(r) * 9} {...common} />
            );
          })}
        </svg>
      );
    case "pressure":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M5 17a7 7 0 1 1 14 0" {...common} />
          <line x1="12" y1="14" x2="16" y2="9" {...common} />
        </svg>
      );
    case "connectivity":
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <path d="M4 9a12 12 0 0 1 16 0M7 12.5a7 7 0 0 1 10 0" {...common} />
          <circle cx="12" cy="17" r="1.4" fill={c} stroke="none" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" style={s}>
          <circle cx="12" cy="12" r="7" {...common} />
        </svg>
      );
  }
}
