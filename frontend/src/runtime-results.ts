import { flowRuntimeNodeId } from "../../shared/engine/flow-graphs.js";
import { decodePinKey, pinKey } from "../../shared/identity.js";
import type { RuntimeStateFrame, RuntimeValueState } from "../../shared/protocol.js";
import { formatServiceCall, type EvalResults, type SinkAction } from "../../shared/results.js";
import type { RWValue } from "../../shared/value.js";
import type { Sample } from "./components/Sparkline.js";

/**
 * Replace local sink previews with the deployed server's authoritative action state. A sink absent
 * from the deployment remains a timestamp-free local preview; the browser never invents trigger
 * history for it.
 */
export function withServerSinkActions(
  results: EvalResults,
  runtime: RuntimeStateFrame,
  flowId: string,
  stale = false,
): EvalResults {
  const actions: Record<string, SinkAction> = { ...results.actions };
  for (const nodeId of Object.keys(actions)) {
    const sink = runtime.sinks[flowRuntimeNodeId(flowId, nodeId)];
    if (!sink) continue;
    actions[nodeId] = {
      call: sink.desired ? formatServiceCall(sink.desired) : null,
      ...(sink.note ? { note: sink.note } : {}),
      status: stale && sink.status === "ok" ? "stale" : sink.status,
      ...(sink.lastCall ? { lastCall: formatServiceCall(sink.lastCall) } : {}),
      ...(sink.lastTriggeredAt !== null ? { lastTriggeredAt: sink.lastTriggeredAt } : {}),
    };
  }
  return { ...results, actions };
}

function runtimeValue(value: RuntimeValueState): RWValue {
  return {
    type: value.type,
    status: value.status,
    v: value.status === "ok" || value.status === "stale" ? value.value : null,
    ...(value.msg ? { msg: value.msg } : {}),
  } as RWValue;
}

/** Map namespaced server pin history back onto the active flow's local pin keys. */
export function serverHistoryForFlow(
  runtime: RuntimeStateFrame,
  flowId: string,
  localPinKeys: readonly string[],
): Record<string, Sample[]> {
  const history: Record<string, Sample[]> = {};
  for (const localKey of localPinKeys) {
    let endpoint: { nodeId: string; pinId: string };
    try {
      endpoint = decodePinKey(localKey);
    } catch {
      continue;
    }
    const runtimeKey = pinKey(flowRuntimeNodeId(flowId, endpoint.nodeId), endpoint.pinId);
    const samples = runtime.history[runtimeKey];
    if (samples) history[localKey] = samples.map((sample) => ({ value: runtimeValue(sample.value), t: sample.t }));
  }
  return history;
}

/** Prefer retained server samples per deployed pin while preserving local preview-only pins. */
export function mergeServerHistory(
  local: Record<string, Sample[]>,
  runtime: RuntimeStateFrame,
  flowId: string,
  localPinKeys: readonly string[],
): Record<string, Sample[]> {
  return { ...local, ...serverHistoryForFlow(runtime, flowId, localPinKeys) };
}
