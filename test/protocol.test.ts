import { describe, expect, it } from "vitest";
import { decodeServerFrame, isHomeLocationFrame } from "../shared/protocol.js";

const valid = {
  type: "homeLocation",
  location: { latitude: 52.3676, longitude: 4.9041, elevation: -2, timeZone: "Europe/Amsterdam" },
};

describe("home location protocol frames", () => {
  it("recognizes and decodes a valid authoritative location", () => {
    expect(isHomeLocationFrame(valid)).toBe(true);
    expect(decodeServerFrame(JSON.stringify(valid))).toEqual(valid);
  });

  it("recognizes an explicit authoritative location clear", () => {
    const clear = { type: "homeLocation", location: null };
    expect(isHomeLocationFrame(clear)).toBe(true);
    expect(decodeServerFrame(JSON.stringify(clear))).toEqual(clear);
  });

  it.each([
    { type: "homeLocation", location: { latitude: 91, longitude: 0, elevation: 0, timeZone: "UTC" } },
    { type: "homeLocation", location: { latitude: 1, longitude: 2, elevation: 3, timeZone: "Mars/Olympus" } },
    { type: "homeLocation", location: { latitude: "1", longitude: 2, elevation: 3, timeZone: "UTC" } },
  ])("rejects malformed location frame %#", (frame) => {
    expect(isHomeLocationFrame(frame)).toBe(false);
    expect(decodeServerFrame(JSON.stringify(frame))).toBeNull();
  });
});
