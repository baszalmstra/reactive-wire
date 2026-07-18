import { describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  let stateListener: ((event: unknown) => void) | undefined;
  const connection = {
    addEventListener: vi.fn((name: string, cb: () => void) => listeners.set(name, cb)),
    subscribeEvents: vi.fn(async (cb: (event: unknown) => void) => { stateListener = cb; return () => {}; }),
  };
  return {
    connection,
    listeners,
    getStates: vi.fn(),
    callService: vi.fn(async () => {}),
    stateListener: () => stateListener,
  };
});

vi.mock("home-assistant-js-websocket", () => ({
  createLongLivedTokenAuth: vi.fn(() => ({})),
  createConnection: vi.fn(async () => harness.connection),
  getStates: harness.getStates,
  callService: harness.callService,
}));

import { RealHA } from "../src/ha/real.js";

const raw = (entity_id: string, state: string) => ({
  entity_id,
  state,
  attributes: {},
  last_changed: "2026-01-01T00:00:00Z",
  last_updated: "2026-01-01T00:00:00Z",
  context: { id: "ctx", parent_id: null, user_id: null },
});

describe("RealHA connection readiness", () => {
  it("requires a reconnect full snapshot before becoming ready or calling services", async () => {
    harness.getStates.mockReset();
    harness.callService.mockClear();
    harness.getStates.mockResolvedValueOnce([raw("light.a", "off")]);
    const ha = await RealHA.connect("http://ha.local", "token");
    expect(ha.connectionStatus()).toEqual({ phase: "ready", epoch: 1, snapshotVersion: 1 });

    harness.listeners.get("disconnected")?.();
    expect(ha.connectionStatus()).toEqual({ phase: "disconnected", epoch: 1, snapshotVersion: null });
    await expect(ha.callService({ domain: "light", service: "turn_on", data: {} })).rejects.toThrow("disconnected");

    let resolveReconnect!: (states: unknown[]) => void;
    harness.getStates.mockImplementationOnce(() => new Promise((resolve) => { resolveReconnect = resolve; }));
    harness.listeners.get("ready")?.();
    expect(ha.connectionStatus()).toEqual({ phase: "syncing", epoch: 2, snapshotVersion: null });
    await expect(ha.callService({ domain: "light", service: "turn_on", data: {} })).rejects.toThrow("syncing");

    resolveReconnect([raw("light.a", "on")]);
    await vi.waitFor(() => expect(ha.connectionStatus()).toEqual({ phase: "ready", epoch: 2, snapshotVersion: 2 }));
    await ha.callService({ domain: "light", service: "turn_on", data: {} });
    expect(harness.callService).toHaveBeenCalledTimes(1);
  });
});
