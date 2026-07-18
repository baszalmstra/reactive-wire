import { describe, it, expect } from "vitest";
import { evaluate, sinkCalls, isSink, isTransientSink, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";

// Build a one-sink graph fed by a single constant source wired to the sink's command pin, so
// each test can drive a sink with a chosen desired value (ok, unavailable, or error).
type Pin = { id: string; type: NodeData["inputs"][number]["type"] };

function source(id: string, pin: Pin, value: NodeData["values"]): NodeData {
  return {
    id, type: `const-${pin.type === "bool" ? "bool" : pin.type === "num" ? "number" : pin.type === "color" ? "color" : pin.type === "duration" ? "duration" : "string"}`,
    title: "", subtitle: "", icon: "const", x: 0, y: 0,
    values: value, inputs: [], outputs: [{ id: "out", label: "", type: pin.type, editable: true }],
  };
}

function sink(type: string, config: Record<string, unknown>, inputs: Pin[]): NodeData {
  return {
    id: "snk", type, title: "", subtitle: "", icon: "const", x: 0, y: 0,
    config, inputs: inputs.map((p) => ({ id: p.id, label: "", type: p.type })), outputs: [],
  };
}

// Wire a list of [pinId -> ok value] sources into the sink, then collect the calls.
function run(
  sinkNode: NodeData,
  wired: Array<{ pin: Pin; value: NodeData["values"] }>,
  entities: EntityMap = {},
  memory: Memory = {} as Memory,
): ReturnType<typeof sinkCalls> {
  const sources = wired.map((w, i) => source(`src${i}`, w.pin, w.value));
  const edges: ViewEdge[] = wired.map((w, i) => ({ id: `e${i}`, from: { node: `src${i}`, pin: "out" }, to: { node: "snk", pin: w.pin.id } }));
  const nodes = [...sources, sinkNode];
  const results = evaluate(nodes, edges, entities, memory);
  return sinkCalls(nodes, results);
}

// A source whose output is forced non-ok by pointing an entity reader at a missing entity.
function offlineSource(id: string, pin: Pin, entityId: string): NodeData {
  return {
    id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id: entityId }, inputs: [], outputs: [{ id: "out", label: "", type: pin.type }],
  };
}

describe("sink registry", () => {
  it("recognizes every new sink type as a sink", () => {
    for (const t of ["sink-light", "sink-call", "sink-climate", "sink-cover", "sink-input", "sink-notify", "sink-tts"]) {
      expect(isSink(t)).toBe(true);
    }
    expect(isSink("compare")).toBe(false);
  });

  it("marks only notify and tts as transient (fire-on-change) sinks", () => {
    expect(isTransientSink("sink-notify")).toBe(true);
    expect(isTransientSink("sink-tts")).toBe(true);
    expect(isTransientSink("sink-climate")).toBe(false);
    expect(isTransientSink("sink-call")).toBe(false);
  });
});

describe("light reconciling sink", () => {
  const node = sink("sink-light", { entity_id: "light.lr" }, [
    { id: "on", type: "bool" },
    { id: "color", type: "color" },
    { id: "brightness", type: "num" },
  ]);

  it("holds when the light is already off and desired off", () => {
    const c = run(node, [{ pin: { id: "on", type: "bool" }, value: { out: false } }], {
      "light.lr": { state: "off", attributes: {} },
    });
    expect(c).toHaveLength(0);
  });

  it("holds when on, rgb_color, and brightness already match", () => {
    const c = run(node, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "color", type: "color" }, value: { out: "#336699" } },
      { pin: { id: "brightness", type: "num" }, value: { out: 180 } },
    ], { "light.lr": { state: "on", attributes: { rgb_color: [51, 102, 153], brightness: 180 } } });
    expect(c).toHaveLength(0);
  });

  it("turns on when the on state differs, carrying desired dimensions", () => {
    const c = run(node, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "color", type: "color" }, value: { out: "#336699" } },
      { pin: { id: "brightness", type: "num" }, value: { out: 180 } },
    ], { "light.lr": { state: "off", attributes: { rgb_color: [51, 102, 153], brightness: 180 } } });
    expect(c[0]!.call).toEqual({ domain: "light", service: "turn_on", data: { rgb_color: [51, 102, 153], brightness: 180 }, target: { entity_id: "light.lr" } });
  });

  it("uses separate optional transition duration pins when the light advertises support", () => {
    const transitionNode = sink("sink-light", { entity_id: "light.lr" }, [
      { id: "on", type: "bool" },
      { id: "transition_on", type: "duration" },
      { id: "transition_off", type: "duration" },
    ]);

    const onCall = run(transitionNode, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "transition_on", type: "duration" }, value: { out: { count: 1500, unit: "ms" } } },
    ], { "light.lr": { state: "off", attributes: { supported_color_modes: ["onoff"], supported_features: 32 } } });
    expect(onCall[0]!.call).toEqual({
      domain: "light", service: "turn_on", data: { transition: 1.5 }, target: { entity_id: "light.lr" },
    });

    const offCall = run(transitionNode, [
      { pin: { id: "on", type: "bool" }, value: { out: false } },
      { pin: { id: "transition_off", type: "duration" }, value: { out: { count: 3, unit: "sec" } } },
    ], { "light.lr": { state: "on", attributes: { supported_color_modes: ["onoff"], supported_features: 32 } } });
    expect(offCall[0]!.call).toEqual({
      domain: "light", service: "turn_off", data: { transition: 3 }, target: { entity_id: "light.lr" },
    });
  });

  it("leaves transition durations unset by default", () => {
    const transitionNode = sink("sink-light", { entity_id: "light.lr" }, [
      { id: "on", type: "bool" },
      { id: "transition_on", type: "duration" },
      { id: "transition_off", type: "duration" },
    ]);
    const c = run(transitionNode, [
      { pin: { id: "on", type: "bool" }, value: { out: false } },
    ], { "light.lr": { state: "on", attributes: { supported_color_modes: ["onoff"], supported_features: 32 } } });
    expect(c[0]!.call.data).toEqual({});
  });

  it("omits wired transitions when the light does not advertise support", () => {
    const transitionNode = sink("sink-light", { entity_id: "light.lr" }, [
      { id: "on", type: "bool" },
      { id: "transition_off", type: "duration" },
    ]);
    const c = run(transitionNode, [
      { pin: { id: "on", type: "bool" }, value: { out: false } },
      { pin: { id: "transition_off", type: "duration" }, value: { out: { count: 4, unit: "sec" } } },
    ], { "light.lr": { state: "on", attributes: { supported_color_modes: ["onoff"], supported_features: 0 } } });
    expect(c[0]!.call).toEqual({
      domain: "light", service: "turn_off", data: {}, target: { entity_id: "light.lr" },
    });
  });

  it("turns on when color differs from rgb_color", () => {
    const c = run(node, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "color", type: "color" }, value: { out: "#336699" } },
    ], { "light.lr": { state: "on", attributes: { rgb_color: [1, 2, 3] } } });
    expect(c[0]!.call.data).toEqual({ rgb_color: [51, 102, 153] });
  });

  it("turns on when requested brightness is missing or different", () => {
    const c = run(node, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "brightness", type: "num" }, value: { out: 128 } },
    ], { "light.lr": { state: "on", attributes: {} } });
    expect(c[0]!.call).toEqual({ domain: "light", service: "turn_on", data: { brightness: 128 }, target: { entity_id: "light.lr" } });
  });

  it("emits the desired call when the actual light state is missing", () => {
    const c = run(node, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "brightness", type: "num" }, value: { out: 64 } },
    ]);
    expect(c[0]!.call).toEqual({ domain: "light", service: "turn_on", data: { brightness: 64 }, target: { entity_id: "light.lr" } });
  });

  const tempNode = sink("sink-light", { entity_id: "light.lr" }, [
    { id: "on", type: "bool" },
    { id: "temperature", type: "num" },
  ]);

  it("turns on with color_temp_kelvin when the temperature differs", () => {
    const c = run(tempNode, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "temperature", type: "num" }, value: { out: 3000 } },
    ], { "light.lr": { state: "on", attributes: { color_temp_kelvin: 2700 } } });
    expect(c[0]!.call).toEqual({ domain: "light", service: "turn_on", data: { color_temp_kelvin: 3000 }, target: { entity_id: "light.lr" } });
  });

  it("holds when the color temperature already matches, including via legacy mireds", () => {
    const c = run(tempNode, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "temperature", type: "num" }, value: { out: 2500 } },
    ], { "light.lr": { state: "on", attributes: { color_temp: 400 } } });
    expect(c).toHaveLength(0);
  });

  it("prefers rgb color over temperature when both are desired", () => {
    const bothNode = sink("sink-light", { entity_id: "light.lr" }, [
      { id: "on", type: "bool" },
      { id: "color", type: "color" },
      { id: "temperature", type: "num" },
    ]);
    const c = run(bothNode, [
      { pin: { id: "on", type: "bool" }, value: { out: true } },
      { pin: { id: "color", type: "color" }, value: { out: "#336699" } },
      { pin: { id: "temperature", type: "num" }, value: { out: 3000 } },
    ], { "light.lr": { state: "off", attributes: {} } });
    expect(c[0]!.call.data).toEqual({ rgb_color: [51, 102, 153] });
  });
});

describe("generic call-service sink", () => {
  const node = (cfg: Record<string, unknown>) =>
    sink("sink-call", { entity_id: "switch.x", ...cfg }, [{ id: "on", type: "bool" }]);

  it("calls the configured on-service with the entity target when on is true", () => {
    const c = run(node({ domain: "switch", service: "turn_on", service_off: "turn_off" }), [{ pin: { id: "on", type: "bool" }, value: { out: true } }]);
    expect(c).toHaveLength(1);
    expect(c[0]!.call).toEqual({ domain: "switch", service: "turn_on", data: {}, target: { entity_id: "switch.x" } });
  });

  it("calls the configured off-service when on is false", () => {
    const c = run(node({ domain: "switch", service: "turn_on", service_off: "turn_off" }), [{ pin: { id: "on", type: "bool" }, value: { out: false } }]);
    expect(c[0]!.call.service).toBe("turn_off");
  });

  it("holds when no off-service is configured and on is false", () => {
    const c = run(node({ domain: "switch", service: "turn_on", service_off: "" }), [{ pin: { id: "on", type: "bool" }, value: { out: false } }]);
    expect(c).toHaveLength(0);
  });

  it("never actuates when the on input is offline (non-ok desired value)", () => {
    const src = offlineSource("off", { id: "on", type: "bool" }, "binary_sensor.missing");
    const snk = node({ domain: "switch", service: "turn_on", service_off: "turn_off" });
    const edges: ViewEdge[] = [{ id: "e", from: { node: "off", pin: "out" }, to: { node: "snk", pin: "on" } }];
    const nodes = [src, snk];
    const c = sinkCalls(nodes, evaluate(nodes, edges, {}, {} as Memory));
    expect(c).toHaveLength(0);
  });
});

describe("climate reconciling sink", () => {
  const node = sink("sink-climate", { entity_id: "climate.t" }, [
    { id: "temperature", type: "num" },
    { id: "hvac_mode", type: "str" },
  ]);

  it("sets the temperature only when it differs from the entity's current value", () => {
    const c = run(node, [{ pin: { id: "temperature", type: "num" }, value: { out: 21 } }], {
      "climate.t": { state: "heat", attributes: { temperature: 19 } },
    });
    expect(c[0]!.call).toEqual({ domain: "climate", service: "set_temperature", data: { temperature: 21 }, target: { entity_id: "climate.t" } });
  });

  it("holds when the temperature already matches (echo-safe no-op)", () => {
    const c = run(node, [{ pin: { id: "temperature", type: "num" }, value: { out: 21 } }], {
      "climate.t": { state: "heat", attributes: { temperature: 21 } },
    });
    expect(c).toHaveLength(0);
  });

  it("sets the hvac mode when it differs, preferring mode over temperature", () => {
    const c = run(node, [
      { pin: { id: "hvac_mode", type: "str" }, value: { out: "heat" } },
      { pin: { id: "temperature", type: "num" }, value: { out: 21 } },
    ], { "climate.t": { state: "off", attributes: { temperature: 19 } } });
    expect(c[0]!.call.service).toBe("set_hvac_mode");
    expect(c[0]!.call.data).toEqual({ hvac_mode: "heat" });
  });

  it("never actuates when the desired temperature is offline", () => {
    const src = offlineSource("off", { id: "temperature", type: "num" }, "sensor.missing");
    const edges: ViewEdge[] = [{ id: "e", from: { node: "off", pin: "out" }, to: { node: "snk", pin: "temperature" } }];
    const nodes = [src, node];
    const c = sinkCalls(nodes, evaluate(nodes, edges, { "climate.t": { state: "heat", attributes: { temperature: 19 } } }, {} as Memory));
    expect(c).toHaveLength(0);
  });
});

describe("cover reconciling sink", () => {
  const node = sink("sink-cover", { entity_id: "cover.c" }, [
    { id: "position", type: "num" },
    { id: "open", type: "bool" },
  ]);

  it("drives to the desired position when it differs from current_position", () => {
    const c = run(node, [{ pin: { id: "position", type: "num" }, value: { out: 50 } }], {
      "cover.c": { state: "open", attributes: { current_position: 100 } },
    });
    expect(c[0]!.call).toEqual({ domain: "cover", service: "set_cover_position", data: { position: 50 }, target: { entity_id: "cover.c" } });
  });

  it("holds when the cover is already at the desired position", () => {
    const c = run(node, [{ pin: { id: "position", type: "num" }, value: { out: 50 } }], {
      "cover.c": { state: "open", attributes: { current_position: 50 } },
    });
    expect(c).toHaveLength(0);
  });

  it("opens a closed cover from a boolean", () => {
    const c = run(node, [{ pin: { id: "open", type: "bool" }, value: { out: true } }], {
      "cover.c": { state: "closed", attributes: {} },
    });
    expect(c[0]!.call.service).toBe("open_cover");
  });

  it("never actuates when the desired position is offline", () => {
    const src = offlineSource("off", { id: "position", type: "num" }, "sensor.missing");
    const edges: ViewEdge[] = [{ id: "e", from: { node: "off", pin: "out" }, to: { node: "snk", pin: "position" } }];
    const nodes = [src, node];
    const c = sinkCalls(nodes, evaluate(nodes, edges, { "cover.c": { state: "open", attributes: { current_position: 100 } } }, {} as Memory));
    expect(c).toHaveLength(0);
  });
});

describe("input_* reconciling sink", () => {
  it("toggles an input_boolean only when its state differs", () => {
    const node = sink("sink-input", { entity_id: "input_boolean.flag" }, [{ id: "value", type: "bool" }]);
    const on = run(node, [{ pin: { id: "value", type: "bool" }, value: { out: true } }], { "input_boolean.flag": { state: "off", attributes: {} } });
    expect(on[0]!.call).toEqual({ domain: "input_boolean", service: "turn_on", data: {}, target: { entity_id: "input_boolean.flag" } });
    const noop = run(node, [{ pin: { id: "value", type: "bool" }, value: { out: true } }], { "input_boolean.flag": { state: "on", attributes: {} } });
    expect(noop).toHaveLength(0);
  });

  it("sets an input_number with set_value when it differs", () => {
    const node = sink("sink-input", { entity_id: "input_number.n" }, [{ id: "value", type: "num" }]);
    const c = run(node, [{ pin: { id: "value", type: "num" }, value: { out: 7 } }], { "input_number.n": { state: "3", attributes: {} } });
    expect(c[0]!.call).toEqual({ domain: "input_number", service: "set_value", data: { value: 7 }, target: { entity_id: "input_number.n" } });
  });

  it("selects an input_select option when it differs", () => {
    const node = sink("sink-input", { entity_id: "input_select.mode" }, [{ id: "value", type: "str" }]);
    const c = run(node, [{ pin: { id: "value", type: "str" }, value: { out: "away" } }], { "input_select.mode": { state: "home", attributes: {} } });
    expect(c[0]!.call).toEqual({ domain: "input_select", service: "select_option", data: { option: "away" }, target: { entity_id: "input_select.mode" } });
  });

  it("uses an unconnected string default for a text/select helper", () => {
    const node = sink("sink-input", { entity_id: "input_select.mode" }, [{ id: "value", type: "any" }]);
    node.inputs[0]!.editable = true;
    node.values = { value: "away" };
    const nodes = [node];
    const c = sinkCalls(nodes, evaluate(nodes, [], { "input_select.mode": { state: "home", attributes: {} } }, {} as Memory));
    expect(c[0]!.call).toEqual({ domain: "input_select", service: "select_option", data: { option: "away" }, target: { entity_id: "input_select.mode" } });
  });

  it("never actuates an input helper when the desired value is offline", () => {
    const node = sink("sink-input", { entity_id: "input_number.n" }, [{ id: "value", type: "num" }]);
    const src = offlineSource("off", { id: "value", type: "num" }, "sensor.missing");
    const edges: ViewEdge[] = [{ id: "e", from: { node: "off", pin: "out" }, to: { node: "snk", pin: "value" } }];
    const nodes = [src, node];
    const c = sinkCalls(nodes, evaluate(nodes, edges, { "input_number.n": { state: "3", attributes: {} } }, {} as Memory));
    expect(c).toHaveLength(0);
  });
});

describe("notify / TTS edge-triggered transient sink", () => {
  // Drive the same notify sink over a sequence of message values, sharing one memory so the
  // edge detection (seed-at-boot, then fire on change) advances across recomputes.
  function sequence(node: NodeData, messages: Array<string | null>, mem: Memory): Array<string | null> {
    const fired: Array<string | null> = [];
    for (const m of messages) {
      const sources: NodeData[] = m == null ? [] : [source("src", { id: "message", type: "str" }, { out: m })];
      const edges: ViewEdge[] = m == null ? [] : [{ id: "e", from: { node: "src", pin: "out" }, to: { node: "snk", pin: "message" } }];
      const nodes = [...sources, node];
      const c = sinkCalls(nodes, evaluate(nodes, edges, {}, mem));
      fired.push(c.length ? String(c[0]!.call.data.message) : null);
    }
    return fired;
  }

  it("seeds at boot: a message already present does not fire on the first recompute", () => {
    const node = sink("sink-notify", { service: "mobile" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    expect(sequence(node, ["hello"], mem)).toEqual([null]);
  });

  it("fires once when the message changes, then holds while unchanged", () => {
    const node = sink("sink-notify", { service: "mobile" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    // boot-seed "a" (no fire), unchanged "a" (no fire), change to "b" (fire), unchanged "b".
    expect(sequence(node, ["a", "a", "b", "b"], mem)).toEqual([null, null, "b", null]);
  });

  it("fires again when the message returns to a previous value (A→B→A is two announcements)", () => {
    const node = sink("sink-notify", { service: "mobile" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    expect(sequence(node, ["a", "b", "a"], mem)).toEqual([null, "b", "a"]);
  });

  it("produces a notify service call carrying the message with no entity target", () => {
    const node = sink("sink-notify", { service: "mobile_app_phone" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    sequence(node, ["first"], mem); // seed
    const nodes = [source("src", { id: "message", type: "str" }, { out: "second" }), node];
    const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "out" }, to: { node: "snk", pin: "message" } }];
    const c = sinkCalls(nodes, evaluate(nodes, edges, {}, mem));
    expect(c[0]!.call).toEqual({ domain: "notify", service: "mobile_app_phone", data: { message: "second" } });
    expect(c[0]!.call.target).toBeUndefined();
  });

  it("speaks a TTS call with no entity target when no media player is configured", () => {
    const node = sink("sink-tts", { service: "speak" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    sequence(node, ["seed"], mem); // boot-seed without firing
    const nodes = [source("src", { id: "message", type: "str" }, { out: "announce" }), node];
    const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "out" }, to: { node: "snk", pin: "message" } }];
    const c = sinkCalls(nodes, evaluate(nodes, edges, {}, mem));
    expect(c[0]!.call).toEqual({ domain: "tts", service: "speak", data: { message: "announce" } });
    expect(c[0]!.call.target).toBeUndefined();
  });

  it("speaks a TTS call targeting the configured media player on change", () => {
    const node = sink("sink-tts", { entity_id: "media_player.kitchen", service: "speak" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    // boot-seed, then change.
    const nodes0 = [source("src", { id: "message", type: "str" }, { out: "seed" }), node];
    const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "out" }, to: { node: "snk", pin: "message" } }];
    sinkCalls(nodes0, evaluate(nodes0, edges, {}, mem));
    const nodes1 = [source("src", { id: "message", type: "str" }, { out: "dinner is ready" }), node];
    const c = sinkCalls(nodes1, evaluate(nodes1, edges, {}, mem));
    expect(c[0]!.call).toEqual({
      domain: "tts", service: "speak",
      data: { message: "dinner is ready", media_player_entity_id: "media_player.kitchen" },
      target: { entity_id: "media_player.kitchen" },
    });
  });

  it("never fires the transient on a non-ok message and does not corrupt the baseline", () => {
    const node = sink("sink-notify", { service: "mobile" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    // boot-seed "a", then message goes offline (no fire, baseline preserved), then back to "a"
    // — since the baseline is still "a", returning to "a" is not a change and must not fire.
    expect(sequence(node, ["a", null, "a"], mem)).toEqual([null, null, null]);
  });

  it("seeds from the first ok message even if the sink booted while the message was offline", () => {
    const node = sink("sink-notify", { service: "mobile" }, [{ id: "message", type: "str" }]);
    const mem: Memory = {} as Memory;
    // offline at boot (nothing to seed, no fire), then first ok message seeds (no fire),
    // then a change fires.
    expect(sequence(node, [null, "a", "b"], mem)).toEqual([null, null, "b"]);
  });
});
