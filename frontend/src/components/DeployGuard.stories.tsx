import type { Meta, StoryObj } from "@storybook/react";
import { DeployGuard } from "./DeployGuard.js";
import type { Problem } from "../canvas/problems.js";

const errors: Problem[] = [
  {
    id: "g-light-brightness",
    severity: "error",
    scope: "structural",
    node: "light",
    title: "light.bedroom",
    message: "Attribute 'brightness' is no longer exposed by the entity.",
  },
];
const warns: Problem[] = [
  {
    id: "u-cmp-a",
    severity: "warn",
    scope: "runtime",
    node: "cmp",
    title: "value < 0",
    message: "Input 'value' is unavailable.",
  },
];

const meta: Meta<typeof DeployGuard> = {
  title: "Chrome/DeployGuard",
  component: DeployGuard,
};
export default meta;

type Story = StoryObj<typeof DeployGuard>;

const summary = "This graph derives and reconciles the state of 1 light. Review before it controls your home.";

export const Blocked: Story = {
  args: { open: true, problems: [...errors, ...warns], summary, onCancel: () => {}, onConfirm: () => {} },
};

export const Warnings: Story = {
  args: { open: true, problems: warns, summary, onCancel: () => {}, onConfirm: () => {} },
};

export const Clean: Story = {
  args: { open: true, problems: [], summary, onCancel: () => {}, onConfirm: () => {} },
};
