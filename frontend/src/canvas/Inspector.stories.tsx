import type { Meta, StoryObj } from "@storybook/react";
import { Inspector } from "./Inspector.js";
import { emptyResults, type EvalResults } from "../../../shared/results.js";
import { V, UN, type RWValue } from "../../../shared/value.js";
import { lightSinkPins, type LightCaps } from "../../../shared/engine/light-caps.js";
import type { NodeData } from "../../../shared/node-types.js";
import { pinKey } from "../../../shared/identity.js";

const ID = "light";

function lightNode(caps: LightCaps | null, title = "light.living_room"): NodeData {
  return {
    id: ID, type: "sink-light", title, subtitle: "Light · reconciling sink",
    icon: "bulb", x: 0, y: 0, w: 248, bodyExtra: 56, widget: "sink",
    config: { entity_id: title },
    inputs: lightSinkPins(caps),
    outputs: [],
  };
}

// Feed the inspector the pin values the engine would have derived for the selected light.
function resultsWith(vals: { on: RWValue; color?: RWValue; temperature?: RWValue; brightness?: RWValue }): EvalResults {
  const r = emptyResults();
  r.inputs[pinKey(ID, "on")] = vals.on;
  if (vals.color) r.inputs[pinKey(ID, "color")] = vals.color;
  if (vals.temperature) r.inputs[pinKey(ID, "temperature")] = vals.temperature;
  if (vals.brightness) r.inputs[pinKey(ID, "brightness")] = vals.brightness;
  return r;
}

const FULL: LightCaps = { brightness: true, rgb: true, colorTemp: true };
const TUNABLE: LightCaps = { brightness: true, rgb: false, colorTemp: true };

const meta: Meta<typeof Inspector> = {
  title: "Chrome/Inspector",
  component: Inspector,
  args: { entities: {}, onConfig: () => {}, onSetValue: () => {} },
};
export default meta;

type Story = StoryObj<typeof Inspector>;

export const LightOnRed: Story = {
  args: { node: lightNode(FULL), results: resultsWith({ on: V("bool", true), color: V("color", "#ff3b30"), brightness: V("num", 229) }) },
};

export const LightTunableWarm: Story = {
  args: { node: lightNode(TUNABLE, "light.desk"), results: resultsWith({ on: V("bool", true), temperature: V("num", 2700), brightness: V("num", 180) }) },
};

export const LightOff: Story = {
  args: { node: lightNode(FULL), results: resultsWith({ on: V("bool", false), color: V("color", "#ff3b30") }) },
};

export const LightIdle: Story = {
  args: { node: lightNode(FULL), results: resultsWith({ on: UN("bool") }) },
};
