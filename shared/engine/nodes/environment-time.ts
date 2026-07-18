import * as SunCalc from "suncalc";
import { ER, UN, V, type RWValue } from "../../value.js";
import { createRecord, setOwn } from "../../record.js";
import { twilightBoundary, twilightBoundaryIndex } from "../../twilight.js";
import { addCalendarDays, calendarDateAt, homeLocationError, isOnCalendarDate, wallTimeEpoch } from "../calendar.js";
import { singleOutput, type NodeDef, type NodeEvaluation } from "../node-def.js";
import { base } from "./template-base.js";

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const timeOfDay: NodeDef<"time-of-day"> = {
  type: "time-of-day",
  description: "Outputs the configured wall-clock time on today's Home Assistant calendar date.",
  dependsOnClock: true,
  template: {
    type: "time-of-day", category: "Time", label: "Time of day", icon: "timestamp",
    make: (id) => base(id, {
      type: "time-of-day", title: "Time of day", subtitle: "Time · home-local today", icon: "timestamp", w: 208,
      config: { time: "20:37" },
      inputs: [],
      outputs: [{ id: "time", label: "time", type: "datetime" }],
    }),
  },
  eval: singleOutput<"time-of-day">("time", ({ cfg, environment, now }) => {
    const location = environment.homeLocation;
    if (!location) return UN("datetime");
    const issue = homeLocationError(location);
    if (issue) return ER("datetime", issue);
    if (!TIME_RE.test(cfg.time)) return ER("datetime", "time must use 24-hour HH:mm format");
    const [hour, minute] = cfg.time.split(":").map(Number) as [number, number];
    try {
      const date = calendarDateAt(now, location.timeZone);
      const epoch = wallTimeEpoch(date, hour, minute, location.timeZone);
      return Number.isFinite(epoch) ? V("datetime", epoch) : ER("datetime", "time calculation was not finite");
    } catch (err) {
      return ER("datetime", err instanceof Error ? err.message : String(err));
    }
  }),
};

function pair(value: RWValue): NodeEvaluation {
  const outputs = createRecord<RWValue>();
  setOwn(outputs, "start", value);
  setOwn(outputs, "end", value);
  return { outputs };
}

function okPair(start: number, end: number): NodeEvaluation {
  const outputs = createRecord<RWValue>();
  setOwn(outputs, "start", V("datetime", start));
  setOwn(outputs, "end", V("datetime", end));
  return { outputs };
}

function eventFor(
  date: { year: number; month: number; day: number },
  boundaryId: unknown,
  location: { latitude: number; longitude: number; elevation: number; timeZone: string },
): number | null {
  const boundary = twilightBoundary(boundaryId);
  if (!boundary) throw new Error(`unknown twilight boundary '${String(boundaryId)}'`);
  // Local noon cannot fall on an adjacent civil date, including UTC±14, and selects the intended
  // solar day without depending on the browser/server process timezone.
  const anchor = wallTimeEpoch(date, 12, 0, location.timeZone);
  // SunCalc treats observer height as a non-negative height above the surrounding horizon. Home
  // Assistant elevation is height above sea level and can legitimately be negative, so clamp it
  // rather than passing a value that makes SunCalc's horizon correction non-finite.
  const observerHeight = Math.max(0, location.elevation);
  const times = SunCalc.getTimes(new Date(anchor), location.latitude, location.longitude, observerHeight) as unknown as Record<string, Date | null | undefined>;
  // Validate the solar day itself, not each event's civil date. At high western longitudes an
  // evening boundary can legitimately land after local midnight while still belonging to this
  // solar day (for example civil dusk in Reykjavik in May).
  const solarNoon = times.solarNoon;
  const solarNoonEpoch = solarNoon instanceof Date ? solarNoon.getTime() : NaN;
  if (!Number.isFinite(solarNoonEpoch) || !isOnCalendarDate(solarNoonEpoch, date, location.timeZone)) return null;
  const event = times[boundary.sunCalcKey];
  const epoch = event instanceof Date ? event.getTime() : NaN;
  return Number.isFinite(epoch) ? epoch : null;
}

export const twilight: NodeDef<"twilight"> = {
  type: "twilight",
  description: "Outputs the start and end instants of a selectable twilight range at the Home Assistant location.",
  dependsOnClock: true,
  template: {
    type: "twilight", category: "Time", label: "Twilight range", icon: "sun",
    make: (id) => base(id, {
      type: "twilight", title: "Twilight range", subtitle: "Sun · home twilight", icon: "sun", w: 230,
      config: { start: "civil-dusk", end: "astronomical-dusk" },
      inputs: [],
      outputs: [
        { id: "start", label: "start", type: "datetime" },
        { id: "end", label: "end", type: "datetime" },
      ],
    }),
  },
  eval: ({ cfg, environment, now }) => {
    const location = environment.homeLocation;
    if (!location) return pair(UN("datetime"));
    const issue = homeLocationError(location);
    if (issue) return pair(ER("datetime", issue));
    const startIndex = twilightBoundaryIndex(cfg.start);
    const endIndex = twilightBoundaryIndex(cfg.end);
    if (startIndex < 0 || endIndex < 0) return pair(ER("datetime", "twilight boundaries are invalid"));
    try {
      const startDate = calendarDateAt(now, location.timeZone);
      const endDate = endIndex > startIndex ? startDate : addCalendarDays(startDate, 1);
      const start = eventFor(startDate, cfg.start, location);
      const end = eventFor(endDate, cfg.end, location);
      if (start === null || end === null) return pair(UN("datetime"));
      if (!Number.isFinite(start) || !Number.isFinite(end)) return pair(ER("datetime", "twilight calculation was not finite"));
      return okPair(start, end);
    } catch (err) {
      return pair(ER("datetime", err instanceof Error ? err.message : String(err)));
    }
  },
};
