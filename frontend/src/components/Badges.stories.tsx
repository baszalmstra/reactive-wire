import type { Meta, StoryObj } from "@storybook/react";
import { HealthDot, MemBadge } from "./Badges.js";

const meta: Meta = {
  title: "Nodes/Badges",
};
export default meta;

type Story = StoryObj;

export const Health: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "center", color: "var(--rw-text)" }}>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <HealthDot health="ok" /> ok
      </span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <HealthDot health="warn" /> warn
      </span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <HealthDot health="error" /> error
      </span>
    </div>
  ),
};

export const Memory: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--rw-text)" }}>
      <MemBadge /> has memory
    </div>
  ),
};
