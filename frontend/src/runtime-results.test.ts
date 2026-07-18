import { describe, expect, it } from "vitest";
import { flowRuntimeNodeId } from "../../shared/engine/flow-graphs.js";
import { pinKey } from "../../shared/identity.js";
import type { RuntimeStateFrame } from "../../shared/protocol.js";
import { emptyResults } from "../../shared/results.js";
import { V } from "../../shared/value.js";
import { mergeServerHistory, serverHistoryForFlow, withServerSinkActions } from "./runtime-results.js";

function runtimeState(): RuntimeStateFrame {
  const sinkId = flowRuntimeNodeId("flow-a", "sink");
  const outputKey = pinKey(flowRuntimeNodeId("flow-a", "source"), "out");
  return {
    type: "runtimeState",
    deployed: true,
    generation: 4,
    mode: "live",
    graphFingerprint: "test-graph",
    sinks: {
      [sinkId]: {
        desired: null,
        note: "holds — no change",
        status: "ok",
        lastCall: { domain: "light", service: "turn_on", data: { brightness: 50 }, target: { entity_id: "light.room" } },
        lastTriggeredAt: 1_700_000_000_000,
      },
    },
    history: {
      [outputKey]: [
        { value: { type: "num", status: "ok", value: 10 }, t: 1000 },
        { value: { type: "num", status: "ok", value: 20 }, t: 2000 },
      ],
    },
  };
}

describe("server runtime results", () => {
  it("uses only the matching flow's server-owned sink trigger history", () => {
    const preview = emptyResults();
    preview.actions.sink = { call: "light.turn_off(light.room)", status: "ok" };

    const authoritative = withServerSinkActions(preview, runtimeState(), "flow-a");
    expect(authoritative.actions.sink).toEqual({
      call: null,
      note: "holds — no change",
      status: "ok",
      lastCall: "light.turn_on(light.room brightness=50)",
      lastTriggeredAt: 1_700_000_000_000,
    });

    const disconnected = withServerSinkActions(preview, runtimeState(), "flow-a", true);
    expect(disconnected.actions.sink?.status).toBe("stale");
    expect(disconnected.actions.sink?.lastTriggeredAt).toBe(1_700_000_000_000);

    const otherFlow = withServerSinkActions(preview, runtimeState(), "flow-b");
    expect(otherFlow.actions.sink).toEqual({ call: "light.turn_off(light.room)", status: "ok" });
    expect(otherFlow.actions.sink?.lastTriggeredAt).toBeUndefined();
  });

  it("maps retained namespaced output samples back to local inspector pin keys", () => {
    const localKey = pinKey("source", "out");
    const history = serverHistoryForFlow(runtimeState(), "flow-a", [localKey]);

    expect(history[localKey]).toEqual([
      { value: V("num", 10), t: 1000 },
      { value: V("num", 20), t: 2000 },
    ]);
    expect(serverHistoryForFlow(runtimeState(), "flow-b", [localKey])).toEqual({});

    const localOnly = { [localKey]: [{ value: V("num", 99), t: 3000 }] };
    expect(mergeServerHistory(localOnly, runtimeState(), "flow-b", [localKey])).toEqual(localOnly);
    expect(mergeServerHistory(localOnly, runtimeState(), "flow-a", [localKey])[localKey]).toEqual(history[localKey]);
  });
});
