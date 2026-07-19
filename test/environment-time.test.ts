import { describe, expect, it } from "vitest";
import { evaluate, type Memory } from "../shared/engine/evaluate.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";
import type { EvaluationEnvironment, HomeLocation } from "../shared/home.js";
import type { NodeData } from "../shared/node-types.js";
import type { TwilightBoundary } from "../shared/twilight.js";

const AMSTERDAM: HomeLocation = { latitude: 52.3676, longitude: 4.9041, elevation: 0, timeZone: "Europe/Amsterdam" };
const NEW_YORK: HomeLocation = { latitude: 40.7128, longitude: -74.006, elevation: 10, timeZone: "America/New_York" };

function output(node: NodeData, now: number, environment: EvaluationEnvironment = {}) {
  return evaluate([node], [], {}, {} as Memory, now, {}, {}, environment).outputs;
}

function timeNode(time: string): NodeData<"time-of-day"> {
  const node = REGISTRY["time-of-day"]!.template.make("clock") as NodeData<"time-of-day">;
  return { ...node, config: { time } };
}

function twilightNode(start: TwilightBoundary, end: TwilightBoundary): NodeData<"twilight"> {
  const node = REGISTRY.twilight!.template.make("tw") as NodeData<"twilight">;
  return { ...node, config: { start, end } };
}

describe("time of day node", () => {
  it("resolves HH:mm on today's Home Assistant calendar date", () => {
    const result = output(timeNode("20:37"), Date.parse("2026-06-15T10:00:00Z"), { homeLocation: AMSTERDAM });
    expect(result["clock:time"]).toEqual({ type: "datetime", v: Date.parse("2026-06-15T18:37:00Z"), status: "ok" });
  });

  it("selects the home-local date near the UTC date line", () => {
    const location: HomeLocation = { latitude: 1.8721, longitude: -157.4278, elevation: 2, timeZone: "Pacific/Kiritimati" };
    const result = output(timeNode("20:37"), Date.parse("2026-01-01T10:30:00Z"), { homeLocation: location });
    expect(result["clock:time"]?.v).toBe(Date.parse("2026-01-02T06:37:00Z"));
  });

  it("uses compatible DST disambiguation for gaps and folds", () => {
    const gap = output(timeNode("02:30"), Date.parse("2026-03-08T16:00:00Z"), { homeLocation: NEW_YORK });
    expect(gap["clock:time"]?.v).toBe(Date.parse("2026-03-08T07:30:00Z"));
    const fold = output(timeNode("01:30"), Date.parse("2026-11-01T16:00:00Z"), { homeLocation: NEW_YORK });
    expect(fold["clock:time"]?.v).toBe(Date.parse("2026-11-01T05:30:00Z"));
  });

  it("is unavailable without location and errors on invalid config/environment", () => {
    expect(output(timeNode("20:37"), 0)["clock:time"]?.status).toBe("unavailable");
    expect(output(timeNode("8:30"), 0, { homeLocation: AMSTERDAM })["clock:time"]?.status).toBe("error");
    expect(output(timeNode("08:30"), 0, { homeLocation: { ...AMSTERDAM, timeZone: "Mars/Olympus" } })["clock:time"]?.status).toBe("error");
  });
});

describe("twilight range node", () => {
  const now = Date.parse("2026-06-15T10:00:00Z");

  it("orders astronomical, nautical, civil, sunrise, sunset, and dusk boundaries", () => {
    const ids: TwilightBoundary[] = [
      "astronomical-dawn", "nautical-dawn", "civil-dawn", "sunrise",
      "sunset", "civil-dusk", "nautical-dusk", "astronomical-dusk",
    ];
    const instants = ids.map((id, index) => {
      const other = index === ids.length - 1 ? "astronomical-dawn" : ids[index + 1]!;
      return Number(output(twilightNode(id, other), now, { homeLocation: NEW_YORK })["tw:start"]?.v);
    });
    expect(instants.every(Number.isFinite)).toBe(true);
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
  });

  it("matches a known Amsterdam civil-twilight fixture", () => {
    const result = output(twilightNode("civil-dawn", "civil-dusk"), now, { homeLocation: AMSTERDAM });
    // SunCalc/USNO convention: center at −6°. Keep a two-minute tolerance for fixture/library updates.
    expect(Math.abs(Number(result["tw:start"]?.v) - Date.parse("2026-06-15T02:28:00Z"))).toBeLessThan(120_000);
    expect(Math.abs(Number(result["tw:end"]?.v) - Date.parse("2026-06-15T20:54:00Z"))).toBeLessThan(120_000);
  });

  it("uses the requested local date in UTC+14", () => {
    const location: HomeLocation = { latitude: 1.8721, longitude: -157.4278, elevation: 2, timeZone: "Pacific/Kiritimati" };
    const result = output(twilightNode("sunrise", "sunset"), Date.parse("2026-01-01T10:30:00Z"), { homeLocation: location });
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: location.timeZone, dateStyle: "short" }).format(Number(result["tw:start"]?.v));
    expect(start).toBe("2026-01-02");
  });

  it("accepts a requested solar day's evening boundary after Reykjavik local midnight", () => {
    const reykjavik: HomeLocation = { latitude: 64.1466, longitude: -21.9426, elevation: 15, timeZone: "Atlantic/Reykjavik" };
    const result = output(twilightNode("sunset", "civil-dusk"), Date.parse("2026-05-15T12:00:00Z"), { homeLocation: reykjavik });
    expect(result["tw:start"]?.status).toBe("ok");
    expect(result["tw:end"]?.status).toBe("ok");
    expect(result["tw:end"]?.v).toBeGreaterThan(result["tw:start"]?.v as number);
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: reykjavik.timeZone, dateStyle: "short" }).format(Number(result["tw:end"]?.v))).toBe("2026-05-16");
  });

  it("clamps a valid below-sea-level Home Assistant elevation for SunCalc", () => {
    const deadSea: HomeLocation = { latitude: 31.559, longitude: 35.4732, elevation: -430, timeZone: "Asia/Jerusalem" };
    const seaLevel = { ...deadSea, elevation: 0 };
    const below = output(twilightNode("sunrise", "sunset"), Date.parse("2026-06-15T09:00:00Z"), { homeLocation: deadSea });
    const clamped = output(twilightNode("sunrise", "sunset"), Date.parse("2026-06-15T09:00:00Z"), { homeLocation: seaLevel });
    expect(below["tw:start"]?.status).toBe("ok");
    expect(below).toEqual(clamped);
  });

  it("uses the requested local date at the negative date-line extreme", () => {
    const location: HomeLocation = { latitude: 0, longitude: -179.9, elevation: 0, timeZone: "Etc/GMT+12" };
    const result = output(twilightNode("sunrise", "sunset"), Date.parse("2026-01-01T10:30:00Z"), { homeLocation: location });
    const start = new Intl.DateTimeFormat("en-CA", { timeZone: location.timeZone, dateStyle: "short" }).format(Number(result["tw:start"]?.v));
    expect(start).toBe("2025-12-31");
  });

  it("wraps an earlier end boundary onto the next local calendar day", () => {
    const result = output(twilightNode("astronomical-dusk", "astronomical-dawn"), Date.parse("2026-03-07T17:00:00Z"), { homeLocation: NEW_YORK });
    const start = Number(result["tw:start"]?.v);
    const end = Number(result["tw:end"]?.v);
    expect(end).toBeGreaterThan(start);
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK.timeZone, day: "2-digit" }).format(start)).toBe("07");
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK.timeZone, day: "2-digit" }).format(end)).toBe("08");
  });

  it("treats equal boundaries as a full wrapped solar day", () => {
    const result = output(twilightNode("sunset", "sunset"), now, { homeLocation: AMSTERDAM });
    expect(Number(result["tw:end"]?.v) - Number(result["tw:start"]?.v)).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  it("makes both pins unavailable atomically when a polar boundary does not occur", () => {
    const tromso: HomeLocation = { latitude: 69.6492, longitude: 18.9553, elevation: 0, timeZone: "Europe/Oslo" };
    const result = output(twilightNode("sunrise", "sunset"), Date.parse("2026-06-15T10:00:00Z"), { homeLocation: tromso });
    expect(result["tw:start"]?.status).toBe("unavailable");
    expect(result["tw:end"]?.status).toBe("unavailable");
  });

  it("is unavailable without location and atomically errors on invalid config", () => {
    const missing = output(twilightNode("civil-dawn", "civil-dusk"), now);
    expect(missing["tw:start"]?.status).toBe("unavailable");
    expect(missing["tw:end"]?.status).toBe("unavailable");
    const node = { ...twilightNode("civil-dawn", "civil-dusk"), config: { start: "blue-hour", end: "civil-dusk" } } as unknown as NodeData;
    const invalid = output(node, now, { homeLocation: AMSTERDAM });
    expect(invalid["tw:start"]?.status).toBe("error");
    expect(invalid["tw:end"]?.status).toBe("error");
  });
});
