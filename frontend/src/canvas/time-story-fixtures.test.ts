import { describe, expect, it } from "vitest";
import { pinKey } from "../../../shared/identity.js";
import { DEMO_HOME_LOCATION } from "../../../shared/home.js";
import { environmentalStoryFixture } from "./time-story-fixtures.js";

const localDay = (epoch: unknown) => new Intl.DateTimeFormat("en-CA", {
  timeZone: DEMO_HOME_LOCATION.timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(Number(epoch));

describe("environmental time story fixtures", () => {
  it("evaluates available default values instead of fabricating display instants", () => {
    const time = environmentalStoryFixture("time-of-day", "time");
    const twilight = environmentalStoryFixture("twilight", "twilight");

    expect(time.results.outputs[pinKey("time", "time")]?.status).toBe("ok");
    expect(twilight.results.outputs[pinKey("twilight", "start")]?.status).toBe("ok");
    expect(twilight.results.outputs[pinKey("twilight", "end")]?.status).toBe("ok");
  });

  it("places a wrapped story end on the next Home Assistant local day", () => {
    const fixture = environmentalStoryFixture("twilight", "wrap", {
      start: "astronomical-dusk",
      end: "civil-dawn",
    });
    const start = fixture.results.outputs[pinKey("wrap", "start")];
    const end = fixture.results.outputs[pinKey("wrap", "end")];

    expect(start?.status).toBe("ok");
    expect(end?.status).toBe("ok");
    expect(Number(end?.v)).toBeGreaterThan(Number(start?.v));
    expect(localDay(start?.v)).toBe("2026-03-18");
    expect(localDay(end?.v)).toBe("2026-03-19");
  });
});
