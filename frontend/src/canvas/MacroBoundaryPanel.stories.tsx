import type { Meta, StoryObj } from "@storybook/react";
import { MacroBoundaryPanel, type BoundaryPin } from "./MacroBoundaryPanel.js";

const inputs: BoundaryPin[] = [
  { nodeId: "mi-in0", pinId: "in0", label: "trigger", type: "bool" },
  { nodeId: "mi-in1", pinId: "in1", label: "threshold", type: "num" },
];
const outputs: BoundaryPin[] = [{ nodeId: "mo-out0", pinId: "out0", label: "state", type: "bool" }];

const handlers = {
  onRename: () => {},
  onRetype: () => {},
  onRemove: () => {},
  onAddInput: () => {},
  onAddOutput: () => {},
};

const meta: Meta<typeof MacroBoundaryPanel> = {
  title: "Canvas/MacroBoundaryPanel",
  component: MacroBoundaryPanel,
  decorators: [
    (Story) => (
      <div className="h-[460px] flex bg-rw-bg">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MacroBoundaryPanel>;

export const Interface: Story = {
  args: { inputs, outputs, ...handlers },
};

export const Empty: Story = {
  args: { inputs: [], outputs: [], ...handlers },
};
