import { afterEach, describe, expect, it, vi } from "vitest";
import { REGISTRY } from "../shared/engine/nodes/index.js";
import type { RuntimeNode } from "../shared/runtime-types.js";
import type { FetchFn } from "../src/server/poller.js";
import { MockHA } from "../src/ha/mock.js";
import { Deployer } from "../src/server/runtime.js";

function made(type: string, id: string): RuntimeNode {
  return REGISTRY[type]!.template.make(id) as RuntimeNode;
}

function boolEntity(id: string, entityId: string): RuntimeNode {
  const node = made("entity", id);
  node.config = { entity_id: entityId };
  node.outputs = [{ id: "state", label: "state", type: "bool" }];
  return node;
}

afterEach(() => vi.useRealTimers());

describe("runtime cause-aware scheduling", () => {
  it("skips unrelated entity updates and evaluates only the relevant closure", () => {
    const ha = new MockHA();
    ha.setState("binary_sensor.a", "off");
    const source = boolEntity("source", "binary_sensor.a");
    const not = made("not", "not");
    const deployer = new Deployer(ha, 100);
    deployer.deploy([source, not], [{ id: "wire", from: { node: "source", pin: "state" }, to: { node: "not", pin: "in" } }], false);

    expect(deployer.inspect()).toMatchObject({ transactionCount: 1, lastCause: "deploy", lastEvaluatedNodeCount: 2 });
    ha.setState("binary_sensor.unrelated", "on");
    expect(deployer.inspect().transactionCount).toBe(1);
    ha.setState("binary_sensor.a", "on");
    expect(deployer.inspect()).toMatchObject({ transactionCount: 2, lastCause: "entities", lastEvaluatedNodeCount: 2 });

    deployer.stop();
  });

  it("creates clock work only for clock-dependent closures", () => {
    vi.useFakeTimers();
    const ha = new MockHA();
    const withoutClock = new Deployer(ha, 100);
    withoutClock.deploy([made("const-bool", "constant")], [], false);
    vi.advanceTimersByTime(500);
    expect(withoutClock.inspect().transactionCount).toBe(1);
    withoutClock.stop();

    const withClock = new Deployer(ha, 100);
    const now = made("now", "now");
    const since = made("since", "since");
    withClock.deploy(
      [now, since],
      [{ id: "wire", from: { node: "now", pin: "time" }, to: { node: "since", pin: "time" } }],
      false,
    );
    vi.advanceTimersByTime(100);
    expect(withClock.inspect()).toMatchObject({ transactionCount: 2, lastCause: "clock", lastEvaluatedNodeCount: 2 });
    withClock.stop();
  });

  it("recomputes only a completed fetch source closure", async () => {
    let resolveFetch!: (value: Awaited<ReturnType<FetchFn>>) => void;
    const fetchFn: FetchFn = () => new Promise((resolve) => { resolveFetch = resolve; });
    const ha = new MockHA();
    const fetch = made("fetch", "fetch");
    fetch.config = { url: "https://example.test/value", path: "", interval: 60, as: "num" };
    const sum = made("sum", "sum");
    const unrelated = made("const-bool", "unrelated");
    const deployer = new Deployer(ha, 100_000, fetchFn);
    deployer.deploy(
      [fetch, sum, unrelated],
      [{ id: "wire", from: { node: "fetch", pin: "value" }, to: { node: "sum", pin: "i0" } }],
      false,
    );
    expect(deployer.inspect().lastEvaluatedNodeCount).toBe(3);

    resolveFetch({ ok: true, status: 200, text: async () => "7" });
    await vi.waitFor(() => expect(deployer.inspect().transactionCount).toBe(2));
    expect(deployer.inspect()).toMatchObject({ lastCause: "fetch", lastEvaluatedNodeCount: 2 });
    deployer.stop();
  });

  it("treats a reconciling sink target entity as a direct dependency", () => {
    const ha = new MockHA();
    ha.setState("input_boolean.flag", "off");
    const desired = made("const-bool", "desired");
    desired.values = { out: true };
    const sink = made("sink-input", "sink");
    sink.config = { entity_id: "input_boolean.flag", kind: "boolean" };
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy(
      [desired, sink],
      [{ id: "wire", from: { node: "desired", pin: "out" }, to: { node: "sink", pin: "value" } }],
      false,
    );
    expect(deployer.inspect().lastEvaluatedNodeCount).toBe(2);

    ha.setState("input_boolean.flag", "on");
    expect(deployer.inspect()).toMatchObject({ transactionCount: 2, lastCause: "entities", lastEvaluatedNodeCount: 1 });
    deployer.stop();
  });
});
