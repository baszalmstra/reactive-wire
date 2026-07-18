import { noOutputs, type SinkCtx, type SinkEvaluation, type NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

/**
 * An edge-triggered transient call (notify / TTS): a fire-and-forget effect with no queryable
 * state, so it fires on a *change* of the message, not on its value. The last fired message is
 * remembered per node and seeded at boot from the message currently present, so a restart with
 * an unchanged message does not re-announce. A non-ok message is never sent and does not
 * advance the remembered value, so a momentarily offline source can't fire a stale message.
 */
function buildTransientCall({ n, cfg, okInput, previousMemory }: SinkCtx): SinkEvaluation {
  const msg = okInput("message");
  const m = { ...previousMemory };
  if (m.prevVal === undefined) m.prevVal = null;
  if (m.seeded === undefined) m.seeded = false;
  // Seed at boot: the first message present establishes the baseline without announcing it,
  // so a freshly deployed or restarted graph doesn't fire for a pre-existing message.
  if (!m.seeded) {
    if (msg) {
      m.prevVal = msg;
      m.seeded = true;
    }
    return { call: null, nextMemory: m };
  }
  if (!msg) return { call: null, nextMemory: m };
  const prev = m.prevVal ?? null;
  const changed = !prev || prev.status !== "ok" || prev.v !== msg.v;
  m.prevVal = msg;
  if (!changed) return { call: null, nextMemory: m };
  if (n.type === "sink-tts") {
    const service = String(cfg.service ?? "speak");
    const data: Record<string, unknown> = { message: msg.v };
    const entityId = String(cfg.entity_id ?? "");
    if (entityId) data.media_player_entity_id = entityId;
    // Only target a media player when one is configured; an empty entity target is rejected.
    const call = entityId ? { domain: "tts", service, data, target: { entity_id: entityId } } : { domain: "tts", service, data };
    return { call, nextMemory: m };
  }
  // notify routes by service name and takes no entity target.
  const service = String(cfg.service ?? "notify");
  return { call: { domain: "notify", service, data: { message: msg.v } }, nextMemory: m };
}

export const sinkNotify: NodeDef = {
  type: "sink-notify",
  description: "Sends a notification each time the message changes.",
  sinkGatePin: "message",
  transient: true,
  template: {
    type: "sink-notify", category: "Sinks", label: "Notify", icon: "mem",
    make: (id) => base(id, {
      type: "sink-notify", title: "notify", subtitle: "Transient · fire on change", icon: "mem", w: 232,
      bodyExtra: 56, widget: "sink",
      stateful: true, config: { service: "notify" },
      inputs: [{ id: "message", label: "message", type: "str", editable: true }],
      outputs: [],
    }),
  },
  eval: noOutputs,
  evalSink: buildTransientCall,
};

export const sinkTts: NodeDef = {
  type: "sink-tts",
  description: "Speaks the message on a media player each time it changes.",
  sinkGatePin: "message",
  transient: true,
  template: {
    type: "sink-tts", category: "Sinks", label: "TTS", icon: "mem",
    requires: { field: "entity_id", kind: "entity", label: "Media player", domains: ["media_player"] },
    make: (id) => base(id, {
      type: "sink-tts", title: "tts", subtitle: "Transient · speak on change", icon: "mem", w: 232,
      bodyExtra: 56, widget: "sink",
      stateful: true, config: { entity_id: "", service: "speak" },
      inputs: [{ id: "message", label: "message", type: "str", editable: true }],
      outputs: [],
    }),
  },
  eval: noOutputs,
  evalSink: buildTransientCall,
};
