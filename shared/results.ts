import type { RWValue, Status } from "./value.js";
import type { Health } from "./node-types.js";
import { createRecord } from "./record.js";

export interface SinkAction {
  call: string | null;
  note?: string;
  status: Status;
  /** Last call observed for this sink, retained while the current action is holding. */
  lastCall?: string;
  /** Epoch milliseconds when the last call was triggered or newly observed. */
  lastTriggeredAt?: number;
}

/**
 * A concrete Home Assistant service call. `target` is omitted for service-targeted calls
 * (notify, or TTS with no media player) where Home Assistant routes by service name and
 * rejects an empty entity target.
 */
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target?: { entity_id: string };
}

/** Resolved runtime values for every pin, keyed `${nodeId}:${pinId}`, plus per-node health. */
export interface EvalResults {
  outputs: Record<string, RWValue>;
  inputs: Record<string, RWValue | null>;
  health: Record<string, Health>;
  actions: Record<string, SinkAction>;
  /** Whether each input pin has an incoming edge, keyed `${nodeId}:${pinId}`. */
  connected: Record<string, boolean>;
  /**
   * The service call each sink node wants to make right now, keyed by node id; null when the
   * sink holds (a non-ok command, or nothing to change). Computed once during evaluate so the
   * edge-triggered sinks advance their memory exactly once per recompute.
   */
  sinks: Record<string, ServiceCall | null>;
}

export const emptyResults = (): EvalResults => ({
  outputs: createRecord(),
  inputs: createRecord(),
  health: createRecord(),
  actions: createRecord(),
  connected: createRecord(),
  sinks: createRecord(),
});
