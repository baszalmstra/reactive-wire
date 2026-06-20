import type { Meta, StoryObj } from "@storybook/react";
import { MacroList } from "./MacroList.js";
import { MACRO_IN, MACRO_OUT, type MacroDef, type MacroMap } from "../../../shared/macros.js";

const latch: MacroDef = {
  id: "m_latch",
  name: "Latch",
  stateful: true,
  inputs: [{ id: "trig", label: "trigger", type: "bool" }],
  outputs: [{ id: "state", label: "state", type: "bool" }],
  nodes: [
    { id: "in", type: MACRO_IN, title: "", subtitle: "", icon: "io-in", x: 0, y: 0, inputs: [], outputs: [{ id: "trig", label: "", type: "bool" }] },
    { id: "out", type: MACRO_OUT, title: "", subtitle: "", icon: "io-out", x: 0, y: 0, inputs: [{ id: "state", label: "", type: "bool" }], outputs: [] },
  ],
  edges: [],
};
const dusk: MacroDef = {
  id: "m_dusk",
  name: "Dusk gate",
  stateful: false,
  inputs: [{ id: "sun", label: "sun", type: "num" }],
  outputs: [{ id: "dark", label: "dark", type: "bool" }],
  nodes: [],
  edges: [],
};

const library: MacroMap = { m_latch: latch, m_dusk: dusk };

const meta: Meta<typeof MacroList> = {
  title: "Canvas/MacroList",
  component: MacroList,
  decorators: [
    (Story) => (
      <div className="w-[244px] bg-rw-panel border border-rw-line rounded-lg py-1">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MacroList>;

const handlers = {
  onPlace: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onImport: () => {},
};

export const WithMacros: Story = {
  args: { macros: library, ...handlers },
};

export const Empty: Story = {
  args: { macros: {}, ...handlers },
};
