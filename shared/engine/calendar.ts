import type { HomeLocation } from "../home.js";

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface WallTime extends CalendarDate {
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (found) return found;
  found = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  // Force eager validation: some engines defer invalid-zone errors until formatting.
  found.format(0);
  formatters.set(timeZone, found);
  return found;
}

function partsAt(epochMs: number, timeZone: string): WallTime & { second: number } {
  const values: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(epochMs)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year!, month: values.month!, day: values.day!,
    hour: values.hour!, minute: values.minute!, second: values.second!,
  };
}

function wallOrdinal(parts: WallTime): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

function sameWall(a: WallTime, b: WallTime): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
    && a.hour === b.hour && a.minute === b.minute;
}

/** Validate the numeric/geographic and IANA-zone parts of an environment location. */
export function homeLocationError(location: HomeLocation): string | null {
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) return "home latitude must be between -90 and 90";
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) return "home longitude must be between -180 and 180";
  if (!Number.isFinite(location.elevation)) return "home elevation must be finite";
  if (!location.timeZone) return "home time zone is missing";
  try {
    formatter(location.timeZone);
  } catch {
    return `invalid home time zone '${location.timeZone}'`;
  }
  return null;
}

/** The calendar date containing an instant in an explicit IANA time zone. */
export function calendarDateAt(epochMs: number, timeZone: string): CalendarDate {
  const p = partsAt(epochMs, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Advance an ISO calendar date; unlike adding 24 hours this is correct across DST changes. */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Whether an instant formats onto the requested calendar date in the given zone. */
export function isOnCalendarDate(epochMs: number, date: CalendarDate, timeZone: string): boolean {
  const actual = calendarDateAt(epochMs, timeZone);
  return actual.year === date.year && actual.month === date.month && actual.day === date.day;
}

/**
 * Resolve a wall-clock minute with Temporal's `compatible` disambiguation: choose the earlier
 * instant in an autumn fold, and shift forward by the gap for a nonexistent spring time.
 */
export function wallTimeEpoch(date: CalendarDate, hour: number, minute: number, timeZone: string): number {
  const desired: WallTime = { ...date, hour, minute };
  const naive = wallOrdinal(desired);
  const offsets = new Set<number>();
  // Sampling both sides of the requested date captures ordinary offsets and a nearby DST change.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3_600_000;
    const actual = partsAt(sample, timeZone);
    const roundedSample = sample - (sample % 60_000);
    offsets.add(Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute) - roundedSample);
  }

  const exact: number[] = [];
  let shifted: { epoch: number; delta: number } | null = null;
  for (const offset of offsets) {
    const epoch = naive - offset;
    const actual = partsAt(epoch, timeZone);
    if (sameWall(actual, desired)) exact.push(epoch);
    else {
      const delta = wallOrdinal(actual) - naive;
      if (delta >= 0 && (!shifted || delta < shifted.delta || (delta === shifted.delta && epoch < shifted.epoch))) {
        shifted = { epoch, delta };
      }
    }
  }
  if (exact.length) return Math.min(...exact);
  if (shifted) return shifted.epoch;
  throw new Error(`could not resolve ${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} in ${timeZone}`);
}
