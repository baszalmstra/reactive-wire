export type DurationUnit = "ms" | "sec" | "min" | "hr" | "day";

export interface DurationUnitOption {
  value: DurationUnit;
  label: string;
  short: string;
}

export interface DurationLiteral {
  count: number;
  unit: DurationUnit;
}

export const DURATION_UNITS: readonly DurationUnitOption[] = [
  { value: "ms", label: "milliseconds", short: "ms" },
  { value: "sec", label: "seconds", short: "s" },
  { value: "min", label: "minutes", short: "min" },
  { value: "hr", label: "hours", short: "h" },
  { value: "day", label: "days", short: "d" },
];

export function normalizeDurationUnit(unit: unknown): DurationUnit {
  switch (String(unit).toLowerCase()) {
    case "ms":
    case "millisecond":
    case "milliseconds":
      return "ms";
    case "min":
    case "minute":
    case "minutes":
      return "min";
    case "h":
    case "hr":
    case "hour":
    case "hours":
      return "hr";
    case "d":
    case "day":
    case "days":
      return "day";
    case "s":
    case "sec":
    case "second":
    case "seconds":
    default:
      return "sec";
  }
}

/** Seconds expressed by a duration count under the given unit. */
export function durationSeconds(count: number, unit: unknown): number {
  switch (normalizeDurationUnit(unit)) {
    case "ms": return count / 1000;
    case "min": return count * 60;
    case "hr": return count * 3600;
    case "day": return count * 86400;
    case "sec":
    default: return count;
  }
}

export function durationUnitSeconds(unit: unknown): number {
  return durationSeconds(1, unit);
}

export function isDurationLiteral(value: unknown): value is DurationLiteral {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isFinite(Number(record.count)) && "unit" in record;
}

export function durationLiteralSeconds(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (isDurationLiteral(value)) return durationSeconds(Number(value.count), value.unit);
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
