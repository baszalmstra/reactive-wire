import type { Meta, StoryObj } from "@storybook/react";
import { Sparkline, type Sample } from "./Sparkline.js";
import { V, UN, ER, type RWValue } from "../../../shared/value.js";

const meta: Meta<typeof Sparkline> = {
  title: "Inspector/Sparkline",
  component: Sparkline,
};
export default meta;

type Story = StoryObj<typeof Sparkline>;

let clock = 0;
const samples = (vals: RWValue[]): Sample[] => vals.map((value) => ({ value, t: (clock += 1000) }));

const Frame = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 260 }}>
    <span style={{ color: "var(--rw-faint)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</span>
    {children}
  </div>
);

// A gentle wave so the numeric line has shape.
const wave = (n: number, amp: number, base: number) =>
  Array.from({ length: n }, (_, i) => V("num", Math.round((base + Math.sin(i / 2.2) * amp) * 10) / 10));

export const Numeric: Story = {
  render: () => <Frame label="numeric"><Sparkline history={samples(wave(28, 4, 21))} /></Frame>,
};

export const Boolean: Story = {
  render: () => (
    <Frame label="boolean (step)">
      <Sparkline
        history={samples([true, true, false, false, true, false, false, true, true, true, false].map((b) => V("bool", b)))}
      />
    </Frame>
  ),
};

export const WithGaps: Story = {
  render: () => (
    <Frame label="numeric with unavailable gaps">
      <Sparkline
        history={samples([
          V("num", 20),
          V("num", 21),
          UN("num"),
          UN("num"),
          V("num", 19),
          V("num", 22),
          ER("num"),
          V("num", 23),
          V("num", 21),
        ])}
      />
    </Frame>
  ),
};

export const NonNumeric: Story = {
  render: () => (
    <Frame label="string (recent-values strip)">
      <Sparkline
        history={samples([
          V("str", "idle"),
          V("str", "heating"),
          V("str", "idle"),
          V("str", "cooling"),
          V("str", "idle"),
        ])}
      />
    </Frame>
  ),
};

export const Empty: Story = {
  render: () => (
    <Frame label="empty (sampling)">
      <Sparkline history={[]} />
    </Frame>
  ),
};

export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
      <Frame label="numeric"><Sparkline history={samples(wave(28, 6, 50))} /></Frame>
      <Frame label="boolean"><Sparkline history={samples([true, false, true, true, false, true].map((b) => V("bool", b)))} /></Frame>
      <Frame label="string"><Sparkline history={samples([V("str", "a"), V("str", "b"), V("str", "a"), V("str", "c")])} /></Frame>
      <Frame label="empty"><Sparkline history={[]} /></Frame>
    </div>
  ),
};
