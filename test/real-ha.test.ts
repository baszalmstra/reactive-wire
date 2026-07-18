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

import { HA_SYNC_BUFFER_LIMIT, HA_SYNC_RETRY_BASE_MS, RealHA } from "../src/ha/real.js";

const raw = (entity_id: string, state: string, lastUpdated = "2026-01-01T00:00:00Z") => ({
  entity_id,
  state,
  attributes: {},
  last_changed: "2026-01-01T00:00:00Z",
  last_updated: lastUpdated,
  context: { id: "ctx", parent_id: null, user_id: null },
});

const changed = (
  entity_id: string,
  oldState: ReturnType<typeof raw> | null,
  newState: ReturnType<typeof raw> | null,
  timeFired = newState?.last_updated ?? oldState?.last_updated ?? "2026-01-01T00:00:00Z",
) => ({
  event_type: "state_changed",
  data: { entity_id, old_state: oldState, new_state: newState },
  origin: "LOCAL",
  time_fired: timeFired,
  context: { id: "event", parent_id: null, user_id: null },
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

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

  it("replays a microsecond-newer buffered event before announcing reconnect readiness", async () => {
    harness.getStates.mockReset();
    harness.getStates.mockResolvedValueOnce([raw("light.a", "off")]);
    const ha = await RealHA.connect("http://ha.local", "token");
    harness.listeners.get("disconnected")?.();

    let resolveReconnect!: (states: unknown[]) => void;
    harness.getStates.mockImplementationOnce(() => new Promise((resolve) => { resolveReconnect = resolve; }));
    harness.listeners.get("ready")?.();
    await flushPromises();
    harness.stateListener()?.(changed(
      "light.a",
      raw("light.a", "off", "2026-01-01T00:00:00.123100Z"),
      raw("light.a", "on", "2026-01-01T00:00:00.123900Z"),
    ));
    resolveReconnect([raw("light.a", "off", "2026-01-01T00:00:00.123100Z")]);

    await vi.waitFor(() => expect(ha.connectionStatus().phase).toBe("ready"));
    expect(ha.entitiesSnapshot().entities["light.a"]?.state).toBe("on");
    expect(ha.connectionStatus().snapshotVersion).toBe(ha.entitiesSnapshot().version);
  });

  it("replays a buffered removal by its event time before announcing readiness", async () => {
    harness.getStates.mockReset();
    const present = raw("light.a", "on", "2026-01-01T00:00:00.123100Z");
    harness.getStates.mockResolvedValueOnce([present]);
    const ha = await RealHA.connect("http://ha.local", "token");
    harness.listeners.get("disconnected")?.();

    let resolveReconnect!: (states: unknown[]) => void;
    harness.getStates.mockImplementationOnce(() => new Promise((resolve) => { resolveReconnect = resolve; }));
    const readySnapshots: Array<string | undefined> = [];
    ha.onConnection((status) => {
      if (status.phase === "ready") readySnapshots.push(ha.entitiesSnapshot().entities["light.a"]?.state);
    });
    harness.listeners.get("ready")?.();
    await flushPromises();
    harness.stateListener()?.(changed("light.a", present, null, "2026-01-01T00:00:01.000000Z"));
    resolveReconnect([present]);

    await vi.waitFor(() => expect(ha.connectionStatus().phase).toBe("ready"));
    expect(ha.entitiesSnapshot().entities["light.a"]).toBeUndefined();
    expect(readySnapshots).toEqual([undefined]);
    expect(ha.connectionStatus().snapshotVersion).toBe(ha.entitiesSnapshot().version);
  });

  it("replays buffered add then remove events in order before readiness", async () => {
    harness.getStates.mockReset();
    harness.getStates.mockResolvedValueOnce([]);
    const ha = await RealHA.connect("http://ha.local", "token");
    harness.listeners.get("disconnected")?.();

    let resolveReconnect!: (states: unknown[]) => void;
    harness.getStates.mockImplementationOnce(() => new Promise((resolve) => { resolveReconnect = resolve; }));
    const updates: string[] = [];
    ha.onEntities((update) => {
      if (update.kind === "delta") updates.push(update.removed.length ? "removed" : "added");
    });
    const readySnapshots: Array<string | undefined> = [];
    ha.onConnection((status) => {
      if (status.phase === "ready") readySnapshots.push(ha.entitiesSnapshot().entities["light.a"]?.state);
    });
    harness.listeners.get("ready")?.();
    await flushPromises();
    const added = raw("light.a", "on", "2026-01-01T00:00:00.500000Z");
    harness.stateListener()?.(changed("light.a", null, added));
    harness.stateListener()?.(changed("light.a", added, null, "2026-01-01T00:00:01.000000Z"));
    resolveReconnect([]);

    await vi.waitFor(() => expect(ha.connectionStatus().phase).toBe("ready"));
    expect(updates).toEqual(["added", "removed"]);
    expect(ha.entitiesSnapshot().entities["light.a"]).toBeUndefined();
    expect(readySnapshots).toEqual([undefined]);
  });

  it("retries a failed reconnect snapshot without another transport-ready event", async () => {
    vi.useFakeTimers();
    try {
      harness.getStates.mockReset();
      harness.getStates.mockResolvedValueOnce([raw("light.a", "off")]);
      const ha = await RealHA.connect("http://ha.local", "token");
      harness.listeners.get("disconnected")?.();
      harness.getStates
        .mockRejectedValueOnce(new Error("temporary getStates failure"))
        .mockResolvedValueOnce([raw("light.a", "on")]);

      harness.listeners.get("ready")?.();
      await flushPromises();
      expect(ha.connectionStatus().phase).toBe("syncing");
      expect(harness.getStates).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(HA_SYNC_RETRY_BASE_MS);
      await flushPromises();
      expect(harness.getStates).toHaveBeenCalledTimes(3);
      expect(ha.connectionStatus()).toEqual({ phase: "ready", epoch: 2, snapshotVersion: 2 });
      expect(ha.entitiesSnapshot().entities["light.a"]?.state).toBe("on");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to another full snapshot when the reconnect event buffer overflows", async () => {
    vi.useFakeTimers();
    try {
      harness.getStates.mockReset();
      harness.getStates.mockResolvedValueOnce([raw("sensor.counter", "0")]);
      const ha = await RealHA.connect("http://ha.local", "token");
      harness.listeners.get("disconnected")?.();
      let resolveFirst!: (states: unknown[]) => void;
      harness.getStates
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockResolvedValueOnce([raw("sensor.counter", "fresh", "2026-01-01T00:00:02Z")]);
      harness.listeners.get("ready")?.();
      await flushPromises();
      for (let i = 0; i <= HA_SYNC_BUFFER_LIMIT; i += 1) {
        harness.stateListener()?.(changed(
          "sensor.counter",
          raw("sensor.counter", String(i), `2026-01-01T00:00:01.${String(i).padStart(6, "0")}Z`),
          raw("sensor.counter", String(i + 1), `2026-01-01T00:00:01.${String(i + 1).padStart(6, "0")}Z`),
        ));
      }
      resolveFirst([raw("sensor.counter", "stale", "2026-01-01T00:00:01Z")]);
      await flushPromises();
      expect(ha.connectionStatus().phase).toBe("syncing");

      await vi.advanceTimersByTimeAsync(HA_SYNC_RETRY_BASE_MS);
      await flushPromises();
      expect(harness.getStates).toHaveBeenCalledTimes(3);
      expect(ha.connectionStatus().phase).toBe("ready");
      expect(ha.entitiesSnapshot().entities["sensor.counter"]?.state).toBe("fresh");
    } finally {
      vi.useRealTimers();
    }
  });
});
