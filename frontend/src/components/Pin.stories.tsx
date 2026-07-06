import type { Meta, StoryObj } from "@storybook/react";
import { Pin } from "./Pin.js";
import { V } from "../../../shared/value.js";

const meta: Meta<typeof Pin> = {
  title: "Nodes/Pin",
  component: Pin,
};
export default meta;

type Story = StoryObj<typeof Pin>;

const NodeBox = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      background: "var(--rw-node)",
      border: "1px solid var(--rw-node-border)",
      borderRadius: 11,
      width: 220,
      padding: "10px 0",
      boxShadow: "var(--rw-shadow)",
    }}
  >
    {children}
  </div>
);

export const Inputs: Story = {
  render: () => (
    <NodeBox>
      <Pin side="in" nodeId="n" pin={{ id: "a", label: "value", type: "num" }} />
      <Pin side="in" nodeId="n" pin={{ id: "b", label: "enabled", type: "bool" }} />
      <Pin side="in" nodeId="n" pin={{ id: "c", label: "name", type: "str" }} />
      <Pin side="in" nodeId="n" pin={{ id: "d", label: "tint", type: "color" }} />
    </NodeBox>
  ),
};

export const Outputs: Story = {
  render: () => (
    <NodeBox>
      <Pin side="out" nodeId="n" pin={{ id: "e", label: "elevation", type: "num", unit: "°" }} value={V("num", -4.2)} />
      <Pin side="out" nodeId="n" pin={{ id: "s", label: "sun is down", type: "bool" }} value={V("bool", true)} />
      <Pin side="out" nodeId="n" pin={{ id: "m", label: "motion", type: "bool" }} value={V("bool", false)} />
      <Pin side="out" nodeId="n" pin={{ id: "c", label: "color", type: "color" }} value={V("color", "#ff3b30")} />
    </NodeBox>
  ),
};

export const SpecialStates: Story = {
  render: () => (
    <NodeBox>
      <Pin side="in" nodeId="n" pin={{ id: "any", label: "then", type: "any" }} />
      <Pin side="in" nodeId="n" pin={{ id: "var", label: "", type: "any", variadic: true }} />
      <Pin side="out" nodeId="n" pin={{ id: "g", label: "brightness", type: "num", ghost: true, missing: "brightness" }} />
      <Pin side="in" nodeId="n" pin={{ id: "hot", label: "hot target", type: "bool" }} hot />
    </NodeBox>
  ),
};
