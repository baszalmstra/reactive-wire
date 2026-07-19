import type { Meta, StoryObj } from "@storybook/react";
import { MobileBar } from "./MobileBar.js";

const meta: Meta<typeof MobileBar> = {
  title: "Chrome/MobileBar",
  component: MobileBar,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  // The bar only displays under the mobile breakpoint, so pin the frame narrow.
  decorators: [
    (Story) => (
      <div style={{ width: 360, position: "relative", height: 80, border: "1px solid var(--rw-line)" }} className="rw-app-mobile">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MobileBar>;

const handlers = {
  onNodes: () => {},
  onComment: () => {},
  onUndo: () => {},
  onRedo: () => {},
  onProblems: () => {},
  onInspect: () => {},
  onDelete: () => {},
};

export const Default: Story = {
  args: { ...handlers, canUndo: true, canRedo: false, hasSelection: false, problemCount: 0 },
};

export const WithProblemsAndSelection: Story = {
  args: { ...handlers, canUndo: true, canRedo: true, hasSelection: true, problemCount: 3 },
};
