import type { PinDef } from "../../../shared/node-types.js";
import { TYPE_VAR } from "../../../shared/theme.js";
import type { RWValue } from "../../../shared/value.js";

export type PortToneClass = "" | "rw-port-bool-on" | "rw-port-bool-off";

export function portTone(pin: PinDef, value?: RWValue | null): { className: PortToneClass; color: string } {
  const base = pin.ghost ? "var(--rw-h-error)" : TYPE_VAR[pin.type];
  if (pin.ghost || pin.type !== "bool" || value?.type !== "bool" || value.status !== "ok") {
    return { className: "", color: base };
  }
  if (value.v === true) return { className: "rw-port-bool-on", color: base };
  return {
    className: "rw-port-bool-off",
    color: `color-mix(in oklab, ${base} 58%, var(--rw-line) 42%)`,
  };
}
