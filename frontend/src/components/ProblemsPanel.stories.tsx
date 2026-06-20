import type { Meta, StoryObj } from "@storybook/react";
import { ProblemsPanel } from "./ProblemsPanel.js";
import type { Problem } from "../canvas/problems.js";

const problems: Problem[] = [
  {
    id: "g-light-brightness",
    severity: "error",
    scope: "structural",
    node: "light",
    title: "light.bedroom",
    message: "Attribute 'brightness' is no longer exposed by the entity — pin kept as a ghost.",
  },
  {
    id: "sel-pick",
    severity: "warn",
    scope: "structural",
    node: "pick",
    title: "Select",
    message: "Unresolved — a, b not wired; output type is still 'any'.",
  },
  {
    id: "e-sum-out",
    severity: "error",
    scope: "runtime",
    node: "sum",
    title: "SUM",
    message: "Output 'sum' is in an error state: non-numeric input.",
  },
  {
    id: "u-cmp-a",
    severity: "warn",
    scope: "runtime",
    node: "cmp",
    title: "value < 0",
    message: "Input 'value' is unavailable.",
  },
];

const meta: Meta<typeof ProblemsPanel> = {
  title: "Chrome/ProblemsPanel",
  component: ProblemsPanel,
  decorators: [
    (Story) => (
      <div style={{ position: "relative", height: 360, background: "var(--rw-canvas)" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof ProblemsPanel>;

export const WithProblems: Story = {
  args: { problems, open: true, onClose: () => {}, onFocus: () => {} },
};

export const Clean: Story = {
  args: { problems: [], open: true, onClose: () => {}, onFocus: () => {} },
};
