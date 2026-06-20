import type { Meta, StoryObj } from "@storybook/react";
import { StatusPill } from "./StatusPill.js";

const meta: Meta<typeof StatusPill> = {
  title: "Chrome/StatusPill",
  component: StatusPill,
};
export default meta;

type Story = StoryObj<typeof StatusPill>;

export const States: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <StatusPill kind="offline" sub="no actuation" />
      <StatusPill kind="live" sub="in sync" />
      <StatusPill kind="draft" sub="undeployed changes" />
    </div>
  ),
};
