import type { Meta, StoryObj } from "@storybook/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { RWNode } from "./RWNode.js";
import { ResultsProvider } from "./results-context.js";
import { emptyResults } from "../../../shared/results.js";
import { V, UN, type RWValue } from "../../../shared/value.js";
import { lightSinkPins, type LightCaps } from "../../../shared/engine/light-caps.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { RWNodeType } from "./validation.js";
import type { SinkAction } from "../../../shared/results.js";
import { pinKey } from "../../../shared/identity.js";

const ID = "light";

// A light sink whose input pins are tailored to the target light's capabilities, like the editor.
function lightDef(caps: LightCaps | null, title = "light.living_room"): NodeData {
  return {
    id: ID, type: "sink-light", title, subtitle: "Light · reconciling sink",
    icon: "bulb", x: 0, y: 0, w: 248, bodyExtra: 56, widget: "sink",
    config: { entity_id: title },
    inputs: lightSinkPins(caps),
    outputs: [],
  };
}

function LightNode({
  caps,
  title,
  on,
  color,
  temperature,
  brightness,
  action,
  actuating,
}: {
  caps: LightCaps | null;
  title?: string;
  on?: RWValue | null;
  color?: RWValue | null;
  temperature?: RWValue | null;
  brightness?: RWValue | null;
  action?: SinkAction;
  actuating?: boolean;
}) {
  const results = emptyResults();
  results.inputs[pinKey(ID, "on")] = on ?? null;
  results.inputs[pinKey(ID, "color")] = color ?? null;
  results.inputs[pinKey(ID, "temperature")] = temperature ?? null;
  results.inputs[pinKey(ID, "brightness")] = brightness ?? null;
  if (action) results.actions[ID] = action;

  const props = { id: ID, data: { def: lightDef(caps, title) }, selected: false } as unknown as NodeProps<RWNodeType>;
  return (
    <ReactFlowProvider>
      <ResultsProvider value={{ results, actuating: !!actuating, entities: {}, onConfig: () => {}, onSetValue: () => {} }}>
        <RWNode {...props} />
      </ResultsProvider>
    </ReactFlowProvider>
  );
}

const FULL: LightCaps = { brightness: true, rgb: true, colorTemp: true };
const TUNABLE: LightCaps = { brightness: true, rgb: false, colorTemp: true };
const ONOFF: LightCaps = { brightness: false, rgb: false, colorTemp: false };

const meta: Meta<typeof LightNode> = {
  title: "Nodes/LightSink",
  component: LightNode,
};
export default meta;

type Story = StoryObj<typeof LightNode>;

// Full-color bulb driven to red — color wins, so no temperature pin value shows in the glow.
export const OnRed: Story = {
  args: {
    caps: FULL,
    on: V("bool", true),
    color: V("color", "#ff3b30"),
    brightness: V("num", 229),
    action: { call: "light.turn_on light.living_room · rgb(255,59,48) · 229", status: "ok" },
  },
};

// Tunable-white bulb: no color pin, driven by a warm color temperature.
export const TunableWarm: Story = {
  args: {
    caps: TUNABLE,
    title: "light.desk",
    on: V("bool", true),
    temperature: V("num", 2700),
    brightness: V("num", 180),
    action: { call: "light.turn_on light.desk · 2700K · 180", status: "ok" },
    actuating: true,
  },
};

// Same tunable-white bulb driven cool.
export const TunableCool: Story = {
  args: {
    caps: TUNABLE,
    title: "light.desk",
    on: V("bool", true),
    temperature: V("num", 6000),
    brightness: V("num", 220),
    action: { call: "light.turn_on light.desk · 6000K · 220", status: "ok" },
  },
};

// On/off-only bulb: a single `on` pin, no color/temperature/brightness.
export const OnOffOnly: Story = {
  args: {
    caps: ONOFF,
    title: "light.porch",
    on: V("bool", true),
    action: { call: "light.turn_on light.porch", status: "ok" },
  },
};

export const Idle: Story = {
  args: {
    caps: FULL,
    on: UN("bool"),
    action: { call: null, note: "holding — on is unavailable", status: "unavailable" },
  },
};

export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
      <LightNode {...(OnRed.args as object)} caps={FULL} />
      <LightNode {...(TunableWarm.args as object)} caps={TUNABLE} />
      <LightNode {...(TunableCool.args as object)} caps={TUNABLE} />
      <LightNode {...(OnOffOnly.args as object)} caps={ONOFF} />
    </div>
  ),
};
