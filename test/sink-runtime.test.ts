import { describe, it, expect, vi } from "vitest";
import { Deployer, type DurableMemory } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";
import type { NodeData } from "../shared/node-types.js";
import type { ViewEdge } from "../shared/engine/evaluate.js";
import type { EntityUpdate } from "../shared/entities.js";

// Exercise the new sinks through the actual server Deployer (the live actuation path), so the
// reconciling de-dupe and the transient fire-on-change bypass are covered end to end. A large
// tick keeps the clock from re-running during the test; entity changes drive the recompute.

/** A notify sink whose message is wired from a string entity's state. */
function notifyGraph(): { nodes: NodeData[]; edges: ViewEdge[] } {
  const nodes: NodeData[] = [
    { id: "src", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "sensor.msg" }, inputs: [], outputs: [{ id: "state", label: "", type: "str" }] },
    { id: "snk", type: "sink-notify", title: "", subtitle: "", icon: "mem", x: 0, y: 0, stateful: true, config: { service: "mobile" }, inputs: [{ id: "message", label: "", type: "str" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "snk", pin: "message" } }];
  return { nodes, edges };
}

/** A reconciling input_boolean sink driven by another boolean entity. */
function helperGraph(): { nodes: NodeData[]; edges: ViewEdge[] } {
  const nodes: NodeData[] = [
    { id: "src", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "binary_sensor.x" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }] },
    { id: "snk", type: "sink-input", title: "", subtitle: "", icon: "const", x: 0, y: 0, config: { entity_id: "input_boolean.flag" }, inputs: [{ id: "value", label: "", type: "bool" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "snk", pin: "value" } }];
  return { nodes, edges };
}

/** A reconciling light sink driven by another boolean entity. */
function lightGraph(): { nodes: NodeData[]; edges: ViewEdge[] } {
  const nodes: NodeData[] = [
    { id: "src", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "binary_sensor.x" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }] },
    { id: "snk", type: "sink-light", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "light.lr" }, inputs: [{ id: "on", label: "", type: "bool" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "snk", pin: "on" } }];
  return { nodes, edges };
}

/** A generic call-service sink driven by a boolean entity. */
function callGraph(): { nodes: NodeData[]; edges: ViewEdge[] } {
  const nodes: NodeData[] = [
    { id: "src", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "binary_sensor.x" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }] },
    {
      id: "snk", type: "sink-call", title: "", subtitle: "", icon: "const", x: 0, y: 0,
      config: { entity_id: "switch.x", domain: "switch", service: "turn_on", service_off: "turn_off" },
      inputs: [{ id: "on", label: "", type: "bool" }], outputs: [],
    },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "snk", pin: "on" } }];
  return { nodes, edges };
}

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("Deployer — transient notify sink", () => {
  it("does not fire for the message present at boot, fires once on change, and re-fires on A→B→A", () => {
    const ha = new MockHA();
    ha.setState("sensor.msg", "hello");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);

    // Seeded at boot from "hello" — no announcement.
    expect(ha.calls).toHaveLength(0);

    ha.setState("sensor.msg", "world");
    expect(ha.calls).toHaveLength(1);
    expect(ha.lastCall()).toEqual({ domain: "notify", service: "mobile", data: { message: "world" } });
    expect(ha.lastCall()?.target).toBeUndefined();

    // Same message again — no new announcement.
    ha.setState("sensor.msg", "world");
    expect(ha.calls).toHaveLength(1);

    // Back to "hello": a genuine change, must fire again despite matching an earlier value.
    ha.setState("sensor.msg", "hello");
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()?.data.message).toBe("hello");

    deployer.stop();
  });

  it("never announces when the message is unavailable (offline source)", () => {
    const ha = new MockHA();
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);
    // sensor.msg never set -> message unavailable -> the safety rule blocks any call.
    expect(ha.calls).toHaveLength(0);
    deployer.stop();
  });
});

describe("Deployer — acknowledged transient delivery", () => {
  it("retains a failed event and retries it independently until acknowledged", async () => {
    vi.useFakeTimers();
    const ha = new MockHA();
    let attempts = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("temporary")) : Promise.resolve();
    };
    let deployer: Deployer | undefined;
    try {
      ha.setState("sensor.msg", "A");
      deployer = new Deployer(ha, 100_000);
      const { nodes, edges } = notifyGraph();
      deployer.deploy(nodes, edges, true);
      ha.setState("sensor.msg", "B");
      await flushPromises();
      expect(ha.calls.map((call) => call.data.message)).toEqual(["B"]);
      expect(deployer.inspect().sinks.snk).toMatchObject({ failures: 1, acknowledgedKey: null });

      ha.setState("sensor.noise", "unrelated");
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
      vi.advanceTimersByTime(1_000);
      await flushPromises();
      expect(ha.calls.map((call) => call.data.message)).toEqual(["B", "B"]);
      expect(deployer.inspect().sinks.snk).toMatchObject({ failures: 0, acknowledgedKey: expect.any(String) });

      // The acknowledged B is now the delivery baseline; a real B→A change produces a new event.
      ha.setState("sensor.msg", "A");
      await flushPromises();
      expect(ha.calls.map((call) => call.data.message)).toEqual(["B", "B", "A"]);
    } finally {
      deployer?.stop();
      vi.useRealTimers();
    }
  });

  it("pauses retry while HA is disconnected and invalidates it on redeploy", async () => {
    vi.useFakeTimers();
    const ha = new MockHA();
    ha.callService = (call) => {
      ha.calls.push(call);
      return Promise.reject(new Error("temporary"));
    };
    let deployer: Deployer | undefined;
    try {
      ha.setState("sensor.msg", "A");
      deployer = new Deployer(ha, 100_000);
      const notify = notifyGraph();
      deployer.deploy(notify.nodes, notify.edges, true);
      ha.setState("sensor.msg", "B");
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      ha.disconnect();
      vi.advanceTimersByTime(5_000);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      // A new generation owns fresh delivery state; the old timer/promise cannot replay into it.
      const call = callGraph();
      deployer.deploy(call.nodes, call.edges, false);
      ha.beginReconnect();
      ha.completeReconnect({ "binary_sensor.x": { state: "off", attributes: {} } });
      vi.advanceTimersByTime(60_000);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
    } finally {
      deployer?.stop();
      vi.useRealTimers();
    }
  });
});

describe("Deployer — serialized sink channels", () => {
  it("keeps the physical lane across redeploy and runs replacement work only after the old call settles", async () => {
    const ha = new MockHA();
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => resolvers.push(() => { active -= 1; resolve(); }));
    };
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = callGraph();
    deployer.deploy(nodes, edges, true);
    ha.setState("binary_sensor.x", "off");
    deployer.deploy(nodes, edges, true);

    expect(ha.calls.map((call) => call.service)).toEqual(["turn_on"]);
    resolvers.shift()?.();
    await flushPromises();
    expect(ha.calls.map((call) => call.service)).toEqual(["turn_on", "turn_off"]);
    expect(maxActive).toBe(1);
    resolvers.shift()?.();
    await flushPromises();
    deployer.stop();
  });

  it("preserves accepted transient FIFO work for an unchanged sink across redeploy", async () => {
    const ha = new MockHA();
    const resolvers: Array<() => void> = [];
    ha.callService = (call) => {
      ha.calls.push(call);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    ha.setState("sensor.msg", "A");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);
    ha.setState("sensor.msg", "B");
    ha.setState("sensor.msg", "C");
    deployer.deploy(nodes, edges, true);

    expect(ha.calls.map((call) => call.data.message)).toEqual(["B"]);
    resolvers.shift()?.();
    await flushPromises();
    expect(ha.calls.map((call) => call.data.message)).toEqual(["B", "C"]);
    resolvers.shift()?.();
    await flushPromises();
    deployer.stop();
  });

  it("finishes an accepted call but discards queued work when its sink is removed", async () => {
    const ha = new MockHA();
    const resolvers: Array<() => void> = [];
    ha.callService = (call) => {
      ha.calls.push(call);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    ha.setState("sensor.msg", "A");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);
    ha.setState("sensor.msg", "B");
    ha.setState("sensor.msg", "C");
    deployer.deploy([], [], true);
    resolvers.shift()?.();
    await flushPromises();

    expect(ha.calls.map((call) => call.data.message)).toEqual(["B"]);
    deployer.stop();
  });

  it("never overlaps command calls and runs the latest pending desired call next", async () => {
    const ha = new MockHA();
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => resolvers.push(() => { active -= 1; resolve(); }));
    };
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = callGraph();
    deployer.deploy(nodes, edges, true);

    ha.setState("binary_sensor.x", "off");
    expect(ha.calls).toHaveLength(1);
    expect(deployer.inspect().sinks.snk).toMatchObject({ inFlight: true, queueDepth: 1, activeSequence: 1 });

    resolvers.shift()?.();
    await flushPromises();
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()?.service).toBe("turn_off");
    expect(maxActive).toBe(1);
    resolvers.shift()?.();
    await flushPromises();
    deployer.stop();
  });

  it("reports and bounds transient overflow by rejecting the newest event", () => {
    const ha = new MockHA();
    ha.callService = (call) => {
      ha.calls.push(call);
      return new Promise<void>(() => {});
    };
    ha.setState("sensor.msg", "seed");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);
    for (let i = 0; i < 102; i += 1) ha.setState("sensor.msg", `message-${i}`);

    expect(ha.calls).toHaveLength(1);
    expect(deployer.inspect().sinks.snk).toMatchObject({ inFlight: true, queueDepth: 100, overflowed: true, status: "error" });
    deployer.stop();
  });

  it("preserves transient transaction order in a FIFO while one call is active", async () => {
    const ha = new MockHA();
    const resolvers: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => resolvers.push(() => { active -= 1; resolve(); }));
    };
    ha.setState("sensor.msg", "A");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = notifyGraph();
    deployer.deploy(nodes, edges, true);
    ha.setState("sensor.msg", "B");
    ha.setState("sensor.msg", "C");

    expect(ha.calls.map((call) => call.data.message)).toEqual(["B"]);
    expect(deployer.inspect().sinks.snk).toMatchObject({ queueDepth: 1, inFlight: true });
    resolvers.shift()?.();
    await flushPromises();
    expect(ha.calls.map((call) => call.data.message)).toEqual(["B", "C"]);
    expect(maxActive).toBe(1);
    resolvers.shift()?.();
    await flushPromises();
    deployer.stop();
  });
});

describe("Deployer — generic call-service sink", () => {
  it("does not repeat the same generic service call on unrelated recomputes", async () => {
    const ha = new MockHA();
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = callGraph();
    deployer.deploy(nodes, edges, true);
    await flushPromises();

    expect(ha.calls).toHaveLength(1);
    expect(ha.lastCall()).toEqual({ domain: "switch", service: "turn_on", data: {}, target: { entity_id: "switch.x" } });

    ha.setState("sensor.noise", "changed");
    await flushPromises();
    expect(ha.calls).toHaveLength(1);

    ha.setState("binary_sensor.x", "off");
    await flushPromises();
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()?.service).toBe("turn_off");

    deployer.stop();
  });

  it("retries a failed command on bounded backoff, not on unrelated recomputes", async () => {
    vi.useFakeTimers();
    const ha = new MockHA();
    let attempts = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
    };
    let deployer: Deployer | undefined;
    try {
      ha.setState("binary_sensor.x", "on");
      deployer = new Deployer(ha, 100_000);
      const { nodes, edges } = callGraph();
      deployer.deploy(nodes, edges, true);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      ha.setState("sensor.noise", "not-a-retry-trigger");
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
      vi.advanceTimersByTime(999);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await flushPromises();
      expect(ha.calls).toHaveLength(2);
      expect(ha.lastCall()?.service).toBe("turn_on");
      expect(deployer.inspect().sinks.snk).toMatchObject({ failures: 0, acknowledgedKey: expect.any(String) });
    } finally {
      deployer?.stop();
      vi.useRealTimers();
    }
  });
});

describe("Deployer — reconciling light sink", () => {
  it("does not repeat the same correction on unrelated recomputes", async () => {
    const ha = new MockHA();
    ha.setState("light.lr", "on");
    ha.setState("binary_sensor.x", "off");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = lightGraph();
    deployer.deploy(nodes, edges, true);
    await flushPromises();

    expect(ha.calls).toHaveLength(1);
    expect(ha.lastCall()).toEqual({ domain: "light", service: "turn_off", data: {}, target: { entity_id: "light.lr" } });

    // The desired value and observed target state are unchanged, so a noisy/ticking recompute
    // must not hammer Home Assistant with the identical correction again.
    ha.setState("sensor.noise", "tick");
    await flushPromises();
    expect(ha.calls).toHaveLength(1);

    // Once the target matches, the correction memory is cleared. A later real drift is corrected.
    ha.setState("light.lr", "off");
    await flushPromises();
    expect(ha.calls).toHaveLength(1);
    ha.setState("light.lr", "on", { marker: 1 });
    await flushPromises();
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()?.service).toBe("turn_off");

    deployer.stop();
  });

  it("revalidates reconciling retries and cancels them when the target already matches", async () => {
    vi.useFakeTimers();
    const ha = new MockHA();
    ha.callService = (call) => {
      ha.calls.push(call);
      return Promise.reject(new Error("temporary"));
    };
    let deployer: Deployer | undefined;
    try {
      ha.setState("light.lr", "on");
      ha.setState("binary_sensor.x", "off");
      deployer = new Deployer(ha, 100_000);
      const { nodes, edges } = lightGraph();
      deployer.deploy(nodes, edges, true);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      // The HA echo/world update removes the correction before its retry deadline.
      ha.setState("light.lr", "off");
      vi.advanceTimersByTime(5_000);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
      expect(deployer.inspect().sinks.snk).toMatchObject({ nextRetryAt: null, inFlight: false });
    } finally {
      deployer?.stop();
      vi.useRealTimers();
    }
  });

  it("marks a failed call as an error and suppresses the same failed context", async () => {
    const ha = new MockHA();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let deployer: Deployer | undefined;
    ha.callService = (call) => {
      ha.calls.push(call);
      return Promise.reject({ message: "boom", code: "service_failed" });
    };
    try {
      ha.setState("light.lr", "on");
      ha.setState("binary_sensor.x", "off");
      deployer = new Deployer(ha, 100_000);
      const { nodes, edges } = lightGraph();
      deployer.deploy(nodes, edges, true);
      await flushPromises();

      expect(ha.calls).toHaveLength(1);
      expect(deployer.inspect().nodes.snk?.health).toBe("error");
      expect(deployer.inspect().sinks.snk?.status).toBe("error");
      expect(deployer.inspect().sinks.snk?.note).toContain("boom");

      ha.setState("sensor.noise", "retry?");
      await flushPromises();
      expect(ha.calls).toHaveLength(1);
      expect(deployer.inspect().sinks.snk?.status).toBe("error");
    } finally {
      deployer?.stop();
      errorSpy.mockRestore();
    }
  });
});

describe("Deployer — Home Assistant readiness", () => {
  it("pauses across disconnect and transport reconnect until a fresh snapshot is ready", async () => {
    const ha = new MockHA();
    ha.setState("light.lr", "on");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = lightGraph();
    deployer.deploy(nodes, edges, true);
    expect(ha.calls).toHaveLength(0);

    ha.disconnect();
    ha.setState("binary_sensor.x", "off");
    ha.beginReconnect();
    expect(deployer.inspect().haStatus).toMatchObject({ phase: "syncing", epoch: 2, snapshotVersion: null });
    expect(ha.calls).toHaveLength(0);

    ha.completeReconnect({
      "light.lr": { state: "on", attributes: {} },
      "binary_sensor.x": { state: "off", attributes: {} },
    });
    await flushPromises();
    expect(deployer.inspect().haStatus).toMatchObject({ phase: "ready", epoch: 2 });
    expect(ha.calls).toHaveLength(1);
    expect(ha.lastCall()?.service).toBe("turn_off");
    deployer.stop();
  });

  it("discards a stale correction when the reconnect snapshot already matches", async () => {
    const ha = new MockHA();
    ha.setState("light.lr", "off");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = lightGraph();
    deployer.deploy(nodes, edges, true);
    await flushPromises();
    expect(ha.calls).toHaveLength(1);

    ha.disconnect();
    ha.beginReconnect();
    ha.completeReconnect({
      "light.lr": { state: "on", attributes: {} },
      "binary_sensor.x": { state: "on", attributes: {} },
    });
    await flushPromises();
    expect(ha.calls).toHaveLength(1);
    deployer.stop();
  });
});

describe("Deployer lifecycle", () => {
  it("terminally deactivates callbacks, ticks, actuation, and durable work", async () => {
    vi.useFakeTimers();
    try {
      const ha = new MockHA();
      let entityCallback: ((update: EntityUpdate) => void) | undefined;
      const unsubscribe = vi.fn();
      vi.spyOn(ha, "onEntities").mockImplementation((callback) => {
        entityCallback = callback;
        return unsubscribe;
      });
      const durable: DurableMemory = {
        restore: vi.fn(),
        capture: vi.fn(),
        stop: vi.fn(),
      };
      ha.setState("binary_sensor.x", "on");
      const deployer = new Deployer(ha, 1_000, undefined, durable);
      const { nodes, edges } = callGraph();
      deployer.deploy(nodes, edges, true);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      deployer.stop();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(durable.stop).toHaveBeenCalledTimes(1);
      expect(deployer.inspect()).toMatchObject({
        deployed: false,
        mode: "dry-run",
        evaluatedAt: null,
        nodes: {},
        sinks: {},
      });

      // Even a callback retained by an ill-behaved feed and clock advancement cannot revive it.
      entityCallback?.({ kind: "delta", version: 999, changed: {}, removed: [] });
      vi.advanceTimersByTime(5_000);
      expect(ha.calls).toHaveLength(1);

      // Shutdown is idempotent, while deployment is permanently rejected afterwards.
      deployer.stop();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(durable.stop).toHaveBeenCalledTimes(1);
      expect(() => deployer.deploy(nodes, edges, true)).toThrow("Deployer has been stopped");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores completion of a service call accepted before shutdown", async () => {
    const ha = new MockHA();
    let resolveCall: (() => void) | undefined;
    ha.callService = (call) => {
      ha.calls.push(call);
      return new Promise<void>((resolve) => { resolveCall = resolve; });
    };
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = callGraph();
    deployer.deploy(nodes, edges, true);
    expect(deployer.inspect().sinks.snk?.inFlight).toBe(true);

    deployer.stop();
    const stopped = deployer.inspect();
    resolveCall?.();
    await flushPromises();

    expect(ha.calls).toHaveLength(1);
    expect(deployer.inspect()).toEqual(stopped);
  });
});

describe("Deployer — reconciling input_boolean sink", () => {
  it("acts only on the diff and not when the helper already matches", async () => {
    const ha = new MockHA();
    ha.setState("input_boolean.flag", "off");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = helperGraph();
    deployer.deploy(nodes, edges, true);

    // Desired on, actual off -> turn_on.
    expect(ha.lastCall()).toEqual({ domain: "input_boolean", service: "turn_on", data: {}, target: { entity_id: "input_boolean.flag" } });
    await flushPromises();
    const after = ha.calls.length;

    // Reflect the actuation back as the new actual state; re-asserting must be a no-op.
    ha.setState("input_boolean.flag", "on");
    await flushPromises();
    expect(ha.calls).toHaveLength(after);

    deployer.stop();
  });

  it("does not re-emit the same correction after Home Assistant echoes an unchanged state", async () => {
    const ha = new MockHA();
    ha.setState("input_boolean.flag", "off");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = helperGraph();
    deployer.deploy(nodes, edges, true);

    expect(ha.calls).toHaveLength(1);
    await flushPromises();
    // HA is still reporting the same target state and the desired value did not change, so the
    // runtime waits instead of retrying the identical correction on every recompute.
    ha.setState("input_boolean.flag", "off");
    await flushPromises();
    expect(ha.calls).toHaveLength(1);

    deployer.stop();
  });

  it("re-emits an identical desired call when the entity later drifts back out of compliance", async () => {
    const ha = new MockHA();
    ha.setState("input_boolean.flag", "off");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = helperGraph();
    deployer.deploy(nodes, edges, true);

    expect(ha.calls).toHaveLength(1);
    await flushPromises();
    ha.setState("input_boolean.flag", "on");
    await flushPromises();
    expect(ha.calls).toHaveLength(1);

    // Drift back to off while the desired value is still on: the needed correction has the same
    // service/data/target as the first one and must fire again.
    ha.setState("input_boolean.flag", "off");
    await flushPromises();
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()).toEqual({ domain: "input_boolean", service: "turn_on", data: {}, target: { entity_id: "input_boolean.flag" } });

    deployer.stop();
  });
});
