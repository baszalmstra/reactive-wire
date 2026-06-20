import type { Meta, StoryObj } from "@storybook/react";
import { Toast } from "./Toast.js";

const meta: Meta<typeof Toast> = {
  title: "Chrome/Toast",
  component: Toast,
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: 140 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof Toast>;

export const Rejection: Story = {
  args: { toast: { id: 1, kind: "error", text: "Type mismatch — a number pin cannot feed a bool pin." } },
};

export const Cycle: Story = {
  args: { toast: { id: 2, kind: "error", text: "That wire would create a cycle — values must flow forward." } },
};

export const Info: Story = {
  args: { toast: { id: 3, kind: "info", text: "Connected → AND" } },
};
