import type { Meta, StoryObj } from "@storybook/react";
import { Banner } from "./Banner.js";

const meta: Meta<typeof Banner> = {
  title: "Chrome/Banner",
  component: Banner,
};
export default meta;

type Story = StoryObj<typeof Banner>;

export const Disconnected: Story = {
  args: { lastSync: "14:32:07" },
};

export const NoLastSync: Story = {
  args: { lastSync: null },
};
