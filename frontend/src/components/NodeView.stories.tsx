import type { Meta, StoryObj } from "@storybook/react";
import { NodeView } from "./NodeView.js";
import type { NodeData } from "../../../shared/node-types.js";
import { type EvalResults, emptyResults } from "../../../shared/results.js";
import { V, UN, ER } from "../../../shared/value.js";

const meta: Meta<typeof NodeView> = {
  title: "Nodes/NodeView",
  component: NodeView,
};
export default meta;

type Story = StoryObj<typeof NodeView>;

const res = (p: Partial<EvalResults>): EvalResults => ({ ...emptyResults(), ...p });

const sun: NodeData = {
  id: "sun", type: "entity.source", title: "sun.sun", subtitle: "Sun", icon: "sun", x: 0, y: 0, w: 214,
  inputs: [],
  outputs: [
    { id: "state", label: "state", type: "str" },
    { id: "elevation", label: "elevation", type: "num", unit: "°" },
    { id: "azimuth", label: "azimuth", type: "num", unit: "°" },
  ],
};

const andNode: NodeData = {
  id: "and", type: "logic.and", title: "AND", subtitle: "Logic", icon: "and", x: 0, y: 0, w: 178,
  inputs: [
    { id: "i0", label: "in", type: "bool" },
    { id: "i1", label: "in", type: "bool" },
    { id: "i2", label: "", type: "any", variadic: true },
  ],
  outputs: [{ id: "out", label: "all true", type: "bool" }],
};

const select: NodeData = {
  id: "sel", type: "flow.select", title: "Select", subtitle: "Generic · resolves on wire", icon: "sel", x: 0, y: 0, w: 200,
  inputs: [
    { id: "cond", label: "if", type: "bool" },
    { id: "a", label: "then", type: "any" },
    { id: "b", label: "else", type: "any" },
  ],
  outputs: [{ id: "out", label: "value", type: "any" }],
};

const toggle: NodeData = {
  id: "toggle", type: "state.toggle", title: "Toggle", subtitle: "Stateful · flip on edge", icon: "mem", x: 0, y: 0, w: 200,
  stateful: true,
  inputs: [{ id: "in", label: "trigger", type: "bool" }],
  outputs: [{ id: "state", label: "state", type: "bool" }],
};

const constColor: NodeData = {
  id: "red", type: "const.color", title: "Color", subtitle: "Constant", icon: "const", x: 0, y: 0, w: 176,
  config: { hex: "#ff3b30" }, bodyExtra: 46, widget: "color",
  inputs: [],
  outputs: [{ id: "value", label: "color", type: "color" }],
};

const sink: NodeData = {
  id: "light", type: "light.sink", title: "light.living_room", subtitle: "Light · reconciling sink", icon: "bulb", x: 0, y: 0, w: 248,
  bodyExtra: 56, widget: "sink",
  inputs: [
    { id: "on", label: "on", type: "bool" },
    { id: "color", label: "color", type: "color" },
  ],
  outputs: [],
};

const degraded: NodeData = {
  id: "bedroom", type: "entity.source", title: "light.bedroom", subtitle: "Light · degraded", icon: "bulb", x: 0, y: 0, w: 224,
  inputs: [],
  outputs: [
    { id: "state", label: "state", type: "bool" },
    { id: "brightness", label: "brightness", type: "num", ghost: true, missing: "brightness" },
  ],
};

export const EntitySource: Story = {
  render: () => (
    <NodeView
      node={sun}
      results={res({
        outputs: {
          "sun:state": V("str", "below_horizon"),
          "sun:elevation": V("num", -4.2),
          "sun:azimuth": V("num", 176.4),
        },
        health: { sun: "ok" },
      })}
    />
  ),
};

export const VariadicAnd: Story = {
  render: () => (
    <NodeView
      node={andNode}
      results={res({
        inputs: { "and:i0": V("bool", true), "and:i1": V("bool", true) },
        outputs: { "and:out": V("bool", true) },
        health: { and: "ok" },
      })}
    />
  ),
};

export const GenericSelect: Story = {
  render: () => (
    <NodeView node={select} results={res({ outputs: { "sel:out": UN("any") }, health: { sel: "ok" } })} />
  ),
};

export const StatefulToggle: Story = {
  render: () => (
    <NodeView node={toggle} results={res({ outputs: { "toggle:state": V("bool", true) }, health: { toggle: "ok" } })} />
  ),
};

export const ConstantColor: Story = {
  render: () => (
    <NodeView node={constColor} results={res({ outputs: { "red:value": V("color", "#ff3b30") }, health: { red: "ok" } })} />
  ),
};

export const SinkDryRun: Story = {
  render: () => (
    <NodeView
      node={sink}
      actuating={false}
      results={res({
        inputs: { "light:on": V("bool", true), "light:color": V("color", "#ff3b30") },
        actions: { light: { call: "light.turn_on(living_room, rgb 255,59,48)", status: "ok" } },
        health: { light: "ok" },
      })}
    />
  ),
};

export const SinkLive: Story = {
  render: () => (
    <NodeView
      node={sink}
      actuating
      results={res({
        inputs: { "light:on": V("bool", true), "light:color": V("color", "#ff3b30") },
        actions: { light: { call: "light.turn_on(living_room, rgb 255,59,48)", status: "ok" } },
        health: { light: "ok" },
      })}
    />
  ),
};

export const DegradedWithGhostPin: Story = {
  render: () => (
    <NodeView
      node={degraded}
      results={res({
        outputs: {
          "bedroom:state": V("bool", true),
          "bedroom:brightness": ER("num", "attribute 'brightness' no longer exposed"),
        },
        health: { bedroom: "error" },
      })}
    />
  ),
};

export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
      <NodeView node={sun} results={res({ outputs: { "sun:state": V("str", "below_horizon"), "sun:elevation": V("num", -4.2), "sun:azimuth": V("num", 176.4) } })} />
      <NodeView node={andNode} results={res({ inputs: { "and:i0": V("bool", true), "and:i1": V("bool", true) }, outputs: { "and:out": V("bool", true) } })} />
      <NodeView node={toggle} results={res({ outputs: { "toggle:state": V("bool", true) } })} />
      <NodeView node={degraded} results={res({ outputs: { "bedroom:state": V("bool", true), "bedroom:brightness": ER("num") }, health: { bedroom: "error" } })} />
    </div>
  ),
};
