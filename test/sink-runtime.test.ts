import { describe, it, expect, vi } from "vitest";
import { Deployer } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";
import type { NodeData } from "../shared/node-types.js";
import type { ViewEdge } from "../shared/engine/evaluate.js";

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

  it("retries a generic service call after a failed attempt", async () => {
    const ha = new MockHA();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    ha.callService = (call) => {
      ha.calls.push(call);
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("boom")) : Promise.resolve();
    };
    try {
      ha.setState("binary_sensor.x", "on");
      const deployer = new Deployer(ha, 100_000);
      const { nodes, edges } = callGraph();
      deployer.deploy(nodes, edges, true);
      await flushPromises();
      expect(ha.calls).toHaveLength(1);

      ha.setState("sensor.noise", "retry");
      await flushPromises();
      expect(ha.calls).toHaveLength(2);
      expect(ha.lastCall()?.service).toBe("turn_on");
      deployer.stop();
    } finally {
      errorSpy.mockRestore();
    }
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

  it("re-emits the same correction after Home Assistant echoes a no-op instead of changing state", async () => {
    const ha = new MockHA();
    ha.setState("input_boolean.flag", "off");
    ha.setState("binary_sensor.x", "on");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = helperGraph();
    deployer.deploy(nodes, edges, true);

    expect(ha.calls).toHaveLength(1);
    await flushPromises();
    // The service call failed or was ignored, and HA reports the helper is still off. Because
    // actual still differs from desired, the identical turn_on correction must not be suppressed.
    ha.setState("input_boolean.flag", "off");
    await flushPromises();
    expect(ha.calls).toHaveLength(2);
    expect(ha.lastCall()).toEqual({ domain: "input_boolean", service: "turn_on", data: {}, target: { entity_id: "input_boolean.flag" } });

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
