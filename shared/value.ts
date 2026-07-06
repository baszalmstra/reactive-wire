import { durationLiteralSeconds } from "./duration.js";
import type { ValueType } from "./theme.js";

export type Status = "ok" | "unavailable" | "error" | "stale";

/**
 * A behavior's current value as the editor renders it: always typed, always with a
 * status. Absence and error are values that flow, never a blank. This is the view-side
 * shape; the runtime engine's `Value<T>` maps onto it by attaching the pin's type and a
 * stale flag derived from the connection.
 */
export interface RWValue {
  type: ValueType;
  v: unknown;
  status: Status;
  msg?: string;
}

export const V = (type: ValueType, v: unknown): RWValue => ({ type, v, status: "ok" });
export const UN = (type: ValueType): RWValue => ({ type, v: null, status: "unavailable" });
export const ER = (type: ValueType, msg?: string): RWValue => ({ type, v: null, status: "error", msg });
export const ST = (type: ValueType, v: unknown): RWValue => ({ type, v, status: "stale" });

export type ChipKind = "none" | "error" | "unavail" | "bool" | "num" | "str" | "color" | "duration" | "datetime" | "any";

export interface Formatted {
  text: string;
  kind: ChipKind;
  bool?: boolean;
  swatch?: string;
  stale?: boolean;
}

/** Chip / inspector formatting for a value. */
export function formatValue(value: RWValue | null | undefined): Formatted {
  if (!value) return { text: "—", kind: "none" };
  if (value.status === "error") return { text: "error", kind: "error" };
  if (value.status === "unavailable") return { text: "unavailable", kind: "unavail" };
  const stale = value.status === "stale";
  switch (value.type) {
    case "bool":
      return { text: value.v === true ? "true" : "false", kind: "bool", bool: value.v === true, stale };
    case "num":
      return { text: fmtNum(value.v), kind: "num", stale };
    case "str":
      return { text: `"${truncate(String(value.v), 16)}"`, kind: "str", stale };
    case "color":
      return { text: String(value.v).toUpperCase(), kind: "color", swatch: String(value.v), stale };
    case "duration":
      return { text: formatDuration(value.v), kind: "duration", stale };
    case "datetime":
      return { text: formatDatetime(value.v), kind: "datetime", stale };
    default:
      return { text: String(value.v ?? "—"), kind: "any", stale };
  }
}

function fmtNum(n: unknown): string {
  if (typeof n !== "number") return String(n);
  return (Math.round(n * 100) / 100).toString();
}

/**
 * A duration's magnitude is carried internally as a number of seconds. Render it like a compact
 * human duration instead of a fractional larger unit: 588 -> "9 min 48 s", 5400 -> "1 h 30 min",
 * 0.25 -> "250 ms". Long values keep the two largest non-zero units so chips stay readable.
 */
export function formatDuration(secondsValue: unknown): string {
  const s = Number(secondsValue);
  if (!Number.isFinite(s)) return String(secondsValue);
  const sign = s < 0 ? "-" : "";
  const abs = Math.abs(s);
  const round1 = (x: number) => (Math.round(x * 10) / 10).toString();
  if (abs < 1) return `${sign}${round1(abs * 1000)} ms`;
  if (abs < 60) return `${sign}${round1(abs)} s`;

  let remaining = Math.round(abs);
  const parts: string[] = [];
  for (const [label, size] of [["d", 86400], ["h", 3600], ["min", 60], ["s", 1]] as const) {
    const count = Math.floor(remaining / size);
    if (count === 0) continue;
    parts.push(`${count} ${label}`);
    remaining -= count * size;
    if (parts.length === 2) break;
  }
  return sign + (parts.join(" ") || "0 s");
}

/**
 * A datetime is an instant carried internally as epoch milliseconds. Render it in the local
 * time zone as a short, human-readable wall-clock string (e.g. "Jun 15, 14:03"). A non-finite
 * value falls back to its raw text rather than an invalid date.
 */
export function formatDatetime(epochMs: unknown): string {
  const ms = Number(epochMs);
  if (!Number.isFinite(ms)) return String(epochMs);
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = String(hex).replace("#", "");
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, "0");
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

const ABSENT = new Set(["unavailable", "unknown", "none", ""]);
const TRUTHY = new Set(["on", "home", "open", "true", "detected", "active", "playing"]);
const FALSY = new Set(["off", "not_home", "closed", "false", "clear", "idle", "paused"]);

// Sensor device classes that report a wall-clock instant or an elapsed span rather than a plain
// magnitude. Everything else with a numeric device class or a unit reads as a number.
const TIMESTAMP_CLASSES = new Set(["timestamp"]);
const DURATION_CLASSES = new Set(["duration"]);
// Device classes whose state is a fixed label drawn from a set, not a measurement.
const ENUM_CLASSES = new Set(["enum"]);

/** Whether a raw value, ignoring absent markers, reads as a finite number. */
function sniffsNumeric(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === "string" && ABSENT.has(raw.toLowerCase())) return false;
  return Number.isFinite(Number(raw));
}

/** Whether a raw value reads as one of the known on/off-style boolean words. */
function sniffsBool(raw: unknown): boolean {
  if (typeof raw === "boolean") return true;
  const s = String(raw).toLowerCase();
  return TRUTHY.has(s) || FALSY.has(s);
}

/** Whether a raw value reads as a hex color string (e.g. "#ff0088"). */
function sniffsColor(raw: unknown): boolean {
  return typeof raw === "string" && raw.startsWith("#");
}

/**
 * The wire type an entity's state pin carries. It is taken from the entity's own metadata so the
 * type stays fixed even while the state is unavailable: a binary_sensor is a bool; a sensor with
 * a timestamp class is a datetime, a duration class is a Duration, an enum or class-less sensor is
 * a string, and any other numeric class or a unit_of_measurement is a number. When no class or
 * unit is present, the current state value is sniffed instead — a color if the state is a hex
 * string, then on/off words as a bool, then a finite number, otherwise a string. An rgb_color
 * attribute does not type the state pin: the state itself (e.g. "on") is the pin's value, and the
 * color lives on a separate rgb_color attribute pin.
 */
export function entityStateType(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): ValueType {
  const domain = entityId.split(".")[0] ?? "";
  const deviceClass = typeof attributes.device_class === "string" ? attributes.device_class.toLowerCase() : "";
  const unit = attributes.unit_of_measurement;
  const hasUnit = unit != null && String(unit) !== "";

  if (domain === "binary_sensor") return "bool";

  if (deviceClass) {
    if (TIMESTAMP_CLASSES.has(deviceClass)) return "datetime";
    if (DURATION_CLASSES.has(deviceClass)) return "duration";
    if (ENUM_CLASSES.has(deviceClass)) return "str";
    // Any other declared device class denotes a measured number.
    return "num";
  }
  if (hasUnit) return "num";

  // No class or unit to lean on: fall back to reading the current value.
  if (sniffsColor(state)) return "color";
  if (sniffsBool(state)) return "bool";
  if (sniffsNumeric(state)) return "num";
  return "str";
}

/** Interpret a raw Home Assistant state/attribute value as the pin's declared type. */
export function parseEntityValue(raw: unknown, type: ValueType): RWValue {
  if (raw == null) return UN(type);
  if (typeof raw === "string" && ABSENT.has(raw.toLowerCase())) return UN(type);
  switch (type) {
    case "bool": {
      if (typeof raw === "boolean") return V("bool", raw);
      const s = String(raw).toLowerCase();
      if (TRUTHY.has(s)) return V("bool", true);
      if (FALSY.has(s)) return V("bool", false);
      return UN("bool");
    }
    case "num": {
      const n = Number(raw);
      return Number.isFinite(n) ? V("num", n) : UN("num");
    }
    case "duration": {
      // A duration's magnitude is carried as a number of seconds. Editable literals may keep
      // the count and display unit they were written with; normalize them before they flow.
      const n = durationLiteralSeconds(raw);
      return n === null ? UN("duration") : V("duration", n);
    }
    case "datetime": {
      // An instant is carried as epoch milliseconds. A raw number is taken as that instant
      // directly; a raw string is parsed as an ISO timestamp.
      if (typeof raw === "number") return Number.isFinite(raw) ? V("datetime", raw) : UN("datetime");
      const ms = Date.parse(String(raw));
      return Number.isFinite(ms) ? V("datetime", ms) : UN("datetime");
    }
    case "color": {
      if (Array.isArray(raw) && raw.length >= 3) return V("color", rgbToHex(Number(raw[0]), Number(raw[1]), Number(raw[2])));
      if (typeof raw === "string" && raw.startsWith("#")) return V("color", raw);
      return UN("color");
    }
    case "str":
      return V("str", String(raw));
    default:
      return V("any", raw);
  }
}
