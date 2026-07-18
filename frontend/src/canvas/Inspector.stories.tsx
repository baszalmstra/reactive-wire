import type { Meta, StoryObj } from "@storybook/react";
import { Inspector } from "./Inspector.js";
import { emptyResults, type EvalResults } from "../../../shared/results.js";
import { V, UN, type RWValue } from "../../../shared/value.js";
import { lightSinkPins, type LightCaps } from "../../../shared/engine/light-caps.js";
import type { NodeData } from "../../../shared/node-types.js";
import { pinKey } from "../../../shared/identity.js";
import { DEMO_HOME_LOCATION } from "../../../shared/home.js";
import { environmentalStoryFixture } from "./time-story-fixtures.js";

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
function resultsWith(vals: { on: RWValue; color?: RWValue; temperature?: RWValue; brightness?: RWValue; transitionOn?: RWValue; transitionOff?: RWValue }): EvalResults {
  const r = emptyResults();
  r.inputs[pinKey(ID, "on")] = vals.on;
  if (vals.color) r.inputs[pinKey(ID, "color")] = vals.color;
  if (vals.temperature) r.inputs[pinKey(ID, "temperature")] = vals.temperature;
  if (vals.brightness) r.inputs[pinKey(ID, "brightness")] = vals.brightness;
  if (vals.transitionOn) r.inputs[pinKey(ID, "transition_on")] = vals.transitionOn;
  if (vals.transitionOff) r.inputs[pinKey(ID, "transition_off")] = vals.transitionOff;
  return r;
}

const FULL: LightCaps = { brightness: true, rgb: true, colorTemp: true, transition: true };
const TUNABLE: LightCaps = { brightness: true, rgb: false, colorTemp: true, transition: true };

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

export const LightTransitions: Story = {
  args: {
    node: lightNode(FULL),
    entities: {
      "light.living_room": {
        state: "on",
        attributes: { supported_color_modes: ["color_temp", "rgb"], supported_features: 32 },
      },
    },
    results: resultsWith({ on: V("bool", true), color: V("color", "#ff3b30"), brightness: V("num", 229) }),
  },
};

const timeFixture = environmentalStoryFixture("time-of-day", "time");
export const TimeOfDay: Story = {
  args: { ...timeFixture, homeLocation: DEMO_HOME_LOCATION },
};

const twilightFixture = environmentalStoryFixture("twilight", "twilight");
export const TwilightRange: Story = {
  args: { ...twilightFixture, homeLocation: DEMO_HOME_LOCATION },
};

const wrappedTwilightFixture = environmentalStoryFixture("twilight", "twilight-wrap", {
  start: "astronomical-dusk",
  end: "civil-dawn",
});
export const TwilightNightWrap: Story = {
  args: { ...wrappedTwilightFixture, homeLocation: DEMO_HOME_LOCATION },
};
