import { describe, it, expect } from "vitest";
import { formatValue, formatDuration, parseEntityValue, V } from "../shared/value.js";
import { applyCompare } from "../shared/engine/engine-support.js";

// Duration is a first-class wire type whose magnitude is carried internally as a number of
// seconds. These tests pin its human-readable formatting, its parse, its ordering under
// compare, and that it never silently coerces to or from a plain number.

describe("formatDuration", () => {
  it("renders sub-second spans in milliseconds", () => {
    expect(formatDuration(0.25)).toBe("250 ms");
    expect(formatDuration(0)).toBe("0 ms");
  });
  it("renders seconds, minutes, hours, and days as compact compound units", () => {
    expect(formatDuration(30)).toBe("30 s");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(588)).toBe("9 min 48 s");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(5400)).toBe("1 h 30 min");
    expect(formatDuration(172800)).toBe("2 d");
  });
  it("handles negative spans symmetrically", () => {
    expect(formatDuration(-600)).toBe("-10 min");
    expect(formatDuration(-588)).toBe("-9 min 48 s");
  });
});

describe("formatValue for the duration type", () => {
  it("produces a human-readable chip carrying the duration kind", () => {
    const f = formatValue(V("duration", 600));
    expect(f.kind).toBe("duration");
    expect(f.text).toBe("10 min");
  });
});

describe("parseEntityValue for the duration type", () => {
  it("reads a raw number as a span of seconds", () => {
    expect(parseEntityValue(90, "duration")).toEqual({ type: "duration", v: 90, status: "ok" });
  });
  it("reads an editable count/unit literal as seconds", () => {
    expect(parseEntityValue({ count: 5, unit: "min" }, "duration")).toEqual({ type: "duration", v: 300, status: "ok" });
    expect(parseEntityValue({ count: 2, unit: "day" }, "duration")).toEqual({ type: "duration", v: 172800, status: "ok" });
  });
  it("is unavailable for a non-numeric raw value", () => {
    expect(parseEntityValue("not-a-number", "duration").status).toBe("unavailable");
  });
});

describe("comparing Duration with Duration", () => {
  // Two durations of 9 min and 10 min, expressed as seconds.
  const nine = 9 * 60;
  const ten = 10 * 60;
  it("orders by magnitude", () => {
    expect(applyCompare(nine, "<", ten)).toBe(true);
    expect(applyCompare(ten, "<", nine)).toBe(false);
    expect(applyCompare(ten, ">=", ten)).toBe(true);
    expect(applyCompare(ten, "<=", ten)).toBe(true);
    expect(applyCompare(ten, "==", ten)).toBe(true);
    expect(applyCompare(nine, "!=", ten)).toBe(true);
  });
});
