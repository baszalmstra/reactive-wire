import { describe, expect, it } from "vitest";
import { deriveStatus } from "./StatusPill.js";

describe("deployment status", () => {
  it("distinguishes the editor feed from Home Assistant readiness", () => {
    expect(deriveStatus(false, false, false, "ready")).toEqual({ kind: "offline", sub: "state unknown" });
    expect(deriveStatus(true, false, false, "disconnected")).toEqual({ kind: "paused", sub: "HA disconnected" });
    expect(deriveStatus(true, false, false, "syncing")).toEqual({ kind: "paused", sub: "HA syncing" });
    expect(deriveStatus(true, true, false, "ready")).toEqual({ kind: "live", sub: "in sync" });
  });
});
