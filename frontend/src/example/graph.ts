import type { NodeData } from "../../../shared/node-types.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";

/**
 * "When the sun is down and someone is in the room, set the living-room light to red;
 * otherwise turn it off" — plus demonstrator nodes for the other anatomies (stateful
 * toggle, generic select, a degraded light with a ghost pin).
 */
export const exampleNodes: NodeData[] = [
  {
    id: "sun", type: "entity", title: "sun.sun", subtitle: "Sun", icon: "sun", x: 60, y: 150, w: 214,
    config: { entity_id: "sun.sun" },
    inputs: [],
    outputs: [
      { id: "state", label: "state", type: "str" },
      { id: "elevation", label: "elevation", type: "num", unit: "°" },
      { id: "azimuth", label: "azimuth", type: "num", unit: "°" },
    ],
  },
  {
    id: "cmp", type: "compare", title: "elevation < 0", subtitle: "Compare", icon: "cmp", x: 360, y: 168, w: 188,
    config: { op: "<", threshold: 0 },
    inputs: [{ id: "a", label: "value", type: "num" }],
    outputs: [{ id: "result", label: "sun is down", type: "bool" }],
  },
  {
    id: "presence", type: "entity", title: "binary_sensor.room", subtitle: "Room presence", icon: "motion", x: 60, y: 396, w: 230,
    config: { entity_id: "binary_sensor.room_presence" },
    inputs: [],
    outputs: [{ id: "state", label: "state", type: "bool" }],
  },
  {
    id: "and", type: "and", title: "AND", subtitle: "Logic", icon: "and", x: 638, y: 250, w: 178,
    inputs: [
      { id: "i0", label: "in", type: "bool" },
      { id: "i1", label: "in", type: "bool" },
      { id: "i2", label: "", type: "any", variadic: true },
    ],
    outputs: [{ id: "out", label: "all true", type: "bool" }],
  },
  {
    id: "red", type: "const-color", title: "Color", subtitle: "Constant", icon: "const", x: 612, y: 470, w: 176,
    config: { hex: "#ff3b30" }, bodyExtra: 46, widget: "color",
    inputs: [],
    outputs: [{ id: "value", label: "color", type: "color" }],
  },
  {
    id: "light", type: "sink-light", title: "light.living_room", subtitle: "Light · reconciling sink", icon: "bulb", x: 916, y: 300, w: 248,
    bodyExtra: 56, widget: "sink", config: { entity_id: "light.living_room" },
    inputs: [
      { id: "on", label: "on", type: "bool" },
      { id: "color", label: "color", type: "color" },
    ],
    outputs: [],
  },
  {
    id: "toggle", type: "toggle", title: "Toggle", subtitle: "Stateful · flip on edge", icon: "mem", x: 360, y: 470, w: 196,
    stateful: true, config: { initial: false },
    inputs: [{ id: "in", label: "trigger", type: "bool" }],
    outputs: [{ id: "state", label: "state", type: "bool" }],
  },
  {
    id: "sel", type: "select", title: "Select", subtitle: "Generic · resolves on wire", icon: "sel", x: 916, y: 470, w: 196,
    inputs: [
      { id: "cond", label: "if", type: "bool" },
      { id: "a", label: "then", type: "any" },
      { id: "b", label: "else", type: "any" },
    ],
    outputs: [{ id: "out", label: "value", type: "any" }],
  },
  {
    id: "bedroom", type: "entity", title: "light.bedroom", subtitle: "Light · degraded", icon: "bulb", x: 60, y: 600, w: 224,
    config: { entity_id: "light.bedroom" },
    inputs: [],
    outputs: [
      { id: "state", label: "state", type: "bool" },
      { id: "brightness", label: "brightness", type: "num", ghost: true, missing: "brightness" },
    ],
  },
];

export const exampleEdges: ViewEdge[] = [
  { id: "e1", from: { node: "sun", pin: "elevation" }, to: { node: "cmp", pin: "a" } },
  { id: "e2", from: { node: "cmp", pin: "result" }, to: { node: "and", pin: "i0" } },
  { id: "e3", from: { node: "presence", pin: "state" }, to: { node: "and", pin: "i1" } },
  { id: "e4", from: { node: "and", pin: "out" }, to: { node: "light", pin: "on" } },
  { id: "e5", from: { node: "red", pin: "value" }, to: { node: "light", pin: "color" } },
];
