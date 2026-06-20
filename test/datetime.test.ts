import { describe, it, expect } from "vitest";
import { formatValue, formatDatetime, parseEntityValue, V } from "../shared/value.js";
import { applyCompare, instantDiffSeconds, shiftInstant } from "../shared/engine/engine-support.js";

// Datetime is a first-class wire type whose instant is carried internally as epoch
// milliseconds. These tests pin its formatting, its parse from numbers and ISO strings, the
// datetime/Duration arithmetic, its ordering under compare, and that it never silently coerces.

describe("formatDatetime", () => {
  it("renders an epoch-ms instant in local wall-clock time", () => {
    // Formatting is locale/zone dependent; assert it produces a non-empty, finite-derived string
    // rather than an exact wall-clock value so the test is stable across machines.
    const text = formatDatetime(Date.UTC(2026, 5, 15, 12, 0, 0));
    expect(text).not.toBe("");
    expect(text).not.toMatch(/Invalid/i);
  });
  it("falls back to raw text for a non-finite value", () => {
    expect(formatDatetime("not-a-date")).toBe("not-a-date");
  });
});

describe("formatValue for the datetime type", () => {
  it("produces a chip carrying the datetime kind", () => {
    const f = formatValue(V("datetime", Date.UTC(2026, 5, 15, 12, 0, 0)));
    expect(f.kind).toBe("datetime");
    expect(f.text).not.toBe("");
  });
});

describe("parseEntityValue for the datetime type", () => {
  it("reads a raw number as an epoch-ms instant", () => {
    expect(parseEntityValue(1_000_000, "datetime")).toEqual({ type: "datetime", v: 1_000_000, status: "ok" });
  });
  it("parses an ISO-8601 string to an epoch-ms instant", () => {
    const iso = "2026-06-15T12:00:00Z";
    expect(parseEntityValue(iso, "datetime")).toEqual({ type: "datetime", v: Date.parse(iso), status: "ok" });
  });
  it("is unavailable for an unparseable string", () => {
    expect(parseEntityValue("not-a-date", "datetime").status).toBe("unavailable");
  });
  it("is unavailable for an absent value", () => {
    expect(parseEntityValue("unavailable", "datetime").status).toBe("unavailable");
    expect(parseEntityValue(null, "datetime").status).toBe("unavailable");
  });
});

describe("datetime / Duration arithmetic", () => {
  it("datetime − datetime = Duration in seconds", () => {
    expect(instantDiffSeconds(1_600_000, 1_000_000)).toBe(600);
    expect(instantDiffSeconds(1_000_000, 1_600_000)).toBe(-600);
  });
  it("datetime + Duration = datetime (epoch ms)", () => {
    expect(shiftInstant(1_000_000, 300, 1)).toBe(1_300_000); // +5 min
  });
  it("datetime − Duration = datetime (epoch ms)", () => {
    expect(shiftInstant(1_000_000, 300, -1)).toBe(700_000); // -5 min
  });
});

describe("comparing datetime with datetime", () => {
  // Two instants expressed as epoch milliseconds; ordering follows their magnitude.
  const earlier = 1_000_000;
  const later = 2_000_000;
  it("orders by instant", () => {
    expect(applyCompare(earlier, "<", later)).toBe(true);
    expect(applyCompare(later, "<", earlier)).toBe(false);
    expect(applyCompare(later, ">=", later)).toBe(true);
    expect(applyCompare(later, "<=", later)).toBe(true);
    expect(applyCompare(later, "==", later)).toBe(true);
    expect(applyCompare(earlier, "!=", later)).toBe(true);
  });
});
