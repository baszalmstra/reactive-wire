import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  let stateListener: ((event: unknown) => void) | undefined;
  let configListener: ((event: unknown) => void) | undefined;
  const unsubStates = vi.fn(async () => {});
  const unsubConfig = vi.fn(async () => {});
  const connection = {
    addEventListener: vi.fn((name: string, cb: () => void) => listeners.set(name, cb)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
    close: vi.fn(),
    subscribeEvents: vi.fn(async (cb: (event: unknown) => void, eventType?: string) => {
      if (eventType === "state_changed") {
        stateListener = cb;
        return unsubStates;
      }
      configListener = cb;
      return unsubConfig;
    }),
  };
  return {
    connection,
    listeners,
    getStates: vi.fn(),
    getConfig: vi.fn(async () => ({ latitude: 52.3676, longitude: 4.9041, elevation: 7, time_zone: "Europe/Amsterdam" })),
    callService: vi.fn(async () => {}),
    stateListener: () => stateListener,
    configListener: () => configListener,
    unsubStates,
    unsubConfig,
  };
});

vi.mock("home-assistant-js-websocket", () => ({
  createLongLivedTokenAuth: vi.fn(() => ({})),
  createConnection: vi.fn(async () => harness.connection),
  getStates: harness.getStates,
  getConfig: harness.getConfig,
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
  beforeEach(() => {
    harness.getConfig.mockReset();
    harness.getConfig.mockResolvedValue({ latitude: 52.3676, longitude: 4.9041, elevation: 7, time_zone: "Europe/Amsterdam" });
    harness.connection.subscribeEvents.mockClear();
    harness.connection.addEventListener.mockClear();
    harness.connection.removeEventListener.mockClear();
    harness.connection.close.mockClear();
    harness.unsubStates.mockClear();
    harness.unsubConfig.mockClear();
  });
  it("requires a reconnect full snapshot before becoming ready or calling services", async () => {
    harness.getStates.mockReset();
    harness.callService.mockClear();
    harness.getStates.mockResolvedValueOnce([raw("light.a", "off")]);
    const ha = await RealHA.connect("http://ha.local", "token");
    expect(ha.connectionStatus()).toEqual({ phase: "ready", epoch: 1, snapshotVersion: 1 });
    expect(ha.homeLocation()).toEqual({ latitude: 52.3676, longitude: 4.9041, elevation: 7, timeZone: "Europe/Amsterdam" });

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

  it("installs lifecycle/config subscriptions before config and retries a transient initial config failure", async () => {
    vi.useFakeTimers();
    try {
      harness.getStates.mockReset();
      harness.getStates.mockResolvedValue([]);
      harness.getConfig
        .mockRejectedValueOnce(new Error("temporary getConfig failure"))
        .mockResolvedValueOnce({ latitude: 64.1466, longitude: -21.9426, elevation: 10, time_zone: "Atlantic/Reykjavik" });

      const connecting = RealHA.connect("http://ha.local", "token");
      await flushPromises();
      expect(harness.connection.addEventListener).toHaveBeenCalledTimes(2);
      expect(harness.connection.subscribeEvents).toHaveBeenCalledWith(expect.any(Function), "state_changed");
      expect(harness.connection.subscribeEvents).toHaveBeenCalledWith(expect.any(Function), "core_config_updated");
      expect(harness.getConfig).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(HA_SYNC_RETRY_BASE_MS);
      const ha = await connecting;
      expect(ha.connectionStatus().phase).toBe("ready");
      expect(ha.homeLocation()).toEqual({ latitude: 64.1466, longitude: -21.9426, elevation: 10, timeZone: "Atlantic/Reykjavik" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resynchronizes config and entities before making a core config update ready", async () => {
    harness.getStates.mockReset();
    harness.getStates.mockResolvedValueOnce([raw("sensor.place", "old")]);
    const ha = await RealHA.connect("http://ha.local", "token");
    const locations: unknown[] = [];
    ha.onLocation((location) => locations.push(location));

    let resolveStates!: (states: unknown[]) => void;
    harness.getStates.mockImplementationOnce(() => new Promise((resolve) => { resolveStates = resolve; }));
    harness.getConfig.mockResolvedValueOnce({ latitude: -33.8688, longitude: 151.2093, elevation: 58, time_zone: "Australia/Sydney" });
    harness.configListener()?.({ event_type: "core_config_updated", data: {} });
    await flushPromises();
    expect(ha.connectionStatus()).toMatchObject({ phase: "syncing", epoch: 2, snapshotVersion: null });
    expect(ha.homeLocation()?.timeZone).toBe("Europe/Amsterdam");

    resolveStates([raw("sensor.place", "new")]);
    await vi.waitFor(() => expect(ha.connectionStatus().phase).toBe("ready"));
    expect(ha.homeLocation()).toEqual({ latitude: -33.8688, longitude: 151.2093, elevation: 58, timeZone: "Australia/Sydney" });
    expect(ha.entitiesSnapshot().entities["sensor.place"]?.state).toBe("new");
    expect(locations).toEqual([{ latitude: -33.8688, longitude: 151.2093, elevation: 58, timeZone: "Australia/Sydney" }]);
  });

  it("keeps a malformed config epoch non-ready and cleans up subscriptions on stop", async () => {
    vi.useFakeTimers();
    try {
      harness.getStates.mockReset();
      harness.getStates.mockResolvedValue([]);
      const ha = await RealHA.connect("http://ha.local", "token");
      harness.getConfig.mockResolvedValue({ latitude: 200, longitude: 0, elevation: 0, time_zone: "UTC" });
      harness.configListener()?.({ event_type: "core_config_updated", data: {} });
      await flushPromises();
      expect(ha.connectionStatus().phase).toBe("syncing");
      await vi.advanceTimersByTimeAsync(HA_SYNC_RETRY_BASE_MS);
      expect(ha.connectionStatus().phase).toBe("syncing");

      ha.stop();
      expect(harness.unsubStates).toHaveBeenCalledOnce();
      expect(harness.unsubConfig).toHaveBeenCalledOnce();
      expect(harness.connection.removeEventListener).toHaveBeenCalledTimes(2);
      expect(harness.connection.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes synchronously while handling rejecting async unsubscribe callbacks", async () => {
    harness.getStates.mockReset();
    harness.getStates.mockResolvedValue([]);
    const ha = await RealHA.connect("http://ha.local", "token");
    harness.unsubStates.mockImplementationOnce(async () => { throw new Error("socket already closed"); });
    harness.unsubConfig.mockImplementationOnce(async () => { throw new Error("socket already closed"); });

    expect(() => ha.stop()).not.toThrow();
    expect(harness.connection.close).toHaveBeenCalledOnce();
    await flushPromises();
    expect(harness.unsubStates).toHaveBeenCalledOnce();
    expect(harness.unsubConfig).toHaveBeenCalledOnce();
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
