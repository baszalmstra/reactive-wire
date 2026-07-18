import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, type Memory } from "../shared/engine/evaluate.js";
import { REGISTRY } from "../shared/engine/nodes/index.js";
import { pinKey } from "../shared/identity.js";
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
  it("bounds retained history payloads while preserving the current runtime output", () => {
    const ha = new MockHA();
    const source = made("const-string", "source");
    source.values = { out: "x".repeat(10_000) };
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy([source], [], false);

    const snapshot = deployer.inspect();
    expect(snapshot.nodes.source?.outputs.out?.value).toHaveLength(10_000);
    const retained = snapshot.history["source:out"]?.[0]?.value.value;
    expect(typeof retained).toBe("string");
    expect(String(retained).length).toBeLessThan(4_200);
    deployer.stop();
  });

  it("caps retained history across the complete graph below the runtime frame budget", () => {
    const ha = new MockHA();
    const sources = Array.from({ length: 1_050 }, (_, index) => {
      const source = made("const-string", `source-${index}`);
      source.values = { out: "x".repeat(5_000) };
      return source;
    });
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy(sources, [], false);

    const history = deployer.inspect().history;
    expect(Object.values(history).reduce((total, samples) => total + samples.length, 0)).toBe(500);
    expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThan(2_500_000);
    deployer.stop();
  });

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

  it("does not replay an expired pulse into a sink when another join branch changes", () => {
    const ha = new MockHA();
    ha.setState("binary_sensor.motion", "off");
    ha.setState("binary_sensor.other", "off");
    const motion = boolEntity("motion", "binary_sensor.motion");
    const other = boolEntity("other", "binary_sensor.other");
    const rising = made("rising", "rising");
    const join = made("and", "join");
    const sink = made("sink-call", "sink");
    sink.config = {
      entity_id: "input_boolean.target",
      domain: "input_boolean",
      service: "turn_on",
      service_off: "turn_off",
    };
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy(
      [motion, other, rising, join, sink],
      [
        { id: "motion-rising", from: { node: "motion", pin: "state" }, to: { node: "rising", pin: "in" } },
        { id: "rising-join", from: { node: "rising", pin: "out" }, to: { node: "join", pin: "i0" } },
        { id: "other-join", from: { node: "other", pin: "state" }, to: { node: "join", pin: "i1" } },
        { id: "join-sink", from: { node: "join", pin: "out" }, to: { node: "sink", pin: "on" } },
      ],
      true,
    );

    ha.setState("binary_sensor.motion", "on");
    expect(deployer.inspect().lastEvaluatedNodeCount).toBe(4);
    ha.setState("binary_sensor.other", "on");

    expect(ha.calls.filter((call) => call.service === "turn_on")).toEqual([]);
    expect(deployer.inspect()).toMatchObject({ lastCause: "entities", lastEvaluatedNodeCount: 4 });
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

  it("fully reevaluates environmental nodes on location replacement and preserves missing/invalid safety", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-01-01T18:00:00Z"));
    const ha = new MockHA({ latitude: 0, longitude: 0, elevation: 0, timeZone: "UTC" });
    const time = made("time-of-day", "home-time");
    time.config = { time: "12:00" };
    const deployer = new Deployer(ha, 100_000);
    deployer.deploy([time], [], false);
    expect(deployer.inspect().nodes["home-time"]?.outputs.time?.value).toBe(Date.parse("2026-01-01T12:00:00Z"));

    ha.setHomeLocation({ latitude: 1.8721, longitude: -157.4278, elevation: 0, timeZone: "Pacific/Kiritimati" });
    expect(deployer.inspect()).toMatchObject({ transactionCount: 2, lastCause: "location", lastEvaluatedNodeCount: 1 });
    expect(deployer.inspect().nodes["home-time"]?.outputs.time?.value).toBe(Date.parse("2026-01-01T22:00:00Z"));

    ha.setHomeLocation(null);
    const serverValue = deployer.inspect().nodes["home-time"]?.outputs.time;
    const previewValue = evaluate([time], [], {}, {} as Memory, Date.now(), {}, {}, { homeLocation: null })
      .outputs[pinKey("home-time", "time")];
    expect(serverValue?.status).toBe("unavailable");
    expect(previewValue?.status).toBe(serverValue?.status);
    ha.setHomeLocation({ latitude: 200, longitude: 0, elevation: 0, timeZone: "UTC" });
    expect(deployer.inspect().nodes["home-time"]?.outputs.time?.status).toBe("error");

    const transactions = deployer.inspect().transactionCount;
    deployer.stop();
    ha.setHomeLocation({ latitude: 0, longitude: 0, elevation: 0, timeZone: "UTC" });
    expect(deployer.inspect().transactionCount).toBe(0);
    expect(transactions).toBe(4);
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
