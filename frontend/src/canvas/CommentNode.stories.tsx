import type { Meta, StoryObj } from "@storybook/react";
import { ReactFlowProvider, type NodeProps } from "@xyflow/react";
import { CommentNode } from "./CommentNode.js";
import { CommentCtx } from "./comments-context.js";
import type { CommentColor, CommentNodeType } from "./comments.js";

// Comment frames are positioned by React Flow on the canvas; in isolation we give them a
// relative wrapper and a no-op operations context so the title bar and handles render.
function Frame({ color, selected, w = 320, h = 180 }: { color: CommentColor; selected?: boolean; w?: number; h?: number }) {
  const props = {
    id: "demo",
    data: { title: "Lighting group", color, w, h },
    selected: !!selected,
  } as unknown as NodeProps<CommentNodeType>;
  return (
    <ReactFlowProvider>
      <CommentCtx.Provider
        value={{ onRename: () => {}, onRecolor: () => {}, onDelete: () => {}, onResizeStart: () => {} }}
      >
        <div style={{ position: "relative", width: w, height: h }}>
          <CommentNode {...props} />
        </div>
      </CommentCtx.Provider>
    </ReactFlowProvider>
  );
}

const meta: Meta<typeof Frame> = {
  title: "Canvas/CommentBox",
  component: Frame,
};
export default meta;

type Story = StoryObj<typeof Frame>;

export const Idle: Story = { args: { color: "blue" } };

export const Selected: Story = { args: { color: "teal", selected: true } };

export const Colors: Story = {
  render: () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
      <Frame color="amber" w={240} h={130} />
      <Frame color="green" w={240} h={130} />
      <Frame color="violet" w={240} h={130} selected />
      <Frame color="rose" w={240} h={130} />
    </div>
  ),
};
