import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "./Tooltip.js";

const meta: Meta<typeof Tooltip> = {
  title: "Chrome/Tooltip",
  component: Tooltip,
};
export default meta;

type Story = StoryObj<typeof Tooltip>;

const trigger = (
  <button className="rounded-[7px] bg-rw-panel2 px-3 py-1.5 text-[12px] text-rw-text">
    Hover or focus me
  </button>
);

export const Right: Story = {
  args: {
    side: "right",
    content: (
      <>
        <div className="font-mono text-[11px] text-rw-text">AND</div>
        <div className="mt-0.5 text-rw-dim">True when every connected input is true.</div>
      </>
    ),
    children: trigger,
  },
};

export const Top: Story = {
  args: {
    side: "top",
    content: "Pulses true when the input goes from false to true.",
    children: trigger,
  },
};
