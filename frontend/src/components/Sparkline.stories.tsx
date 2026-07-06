import type { Meta, StoryObj } from "@storybook/react";
import { Sparkline, type Sample } from "./Sparkline.js";
import { V, UN, ER, type RWValue } from "../../../shared/value.js";

const meta: Meta<typeof Sparkline> = {
  title: "Inspector/Sparkline",
  component: Sparkline,
};
export default meta;

type Story = StoryObj<typeof Sparkline>;

const samples = (vals: RWValue[], start = Date.now() - vals.length * 1000, step = 1000): Sample[] =>
  vals.map((value, i) => ({ value, t: start + i * step }));

const Frame = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 260 }}>
    <span style={{ color: "var(--rw-faint)", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</span>
    {children}
  </div>
);

// A gentle wave so the numeric line has shape.
const wave = (n: number, amp: number, base: number) =>
  Array.from({ length: n }, (_, i) => V("num", Math.round((base + Math.sin(i / 2.2) * amp) * 10) / 10));

const now = Date.now();

export const Numeric: Story = {
  render: () => <Frame label="numeric"><Sparkline history={samples(wave(28, 4, 21))} /></Frame>,
};

export const Duration: Story = {
  render: () => (
    <Frame label="duration trend">
      <Sparkline history={samples([30, 45, 60, 90, 120, 180, 210, 240].map((s) => V("duration", s)))} />
    </Frame>
  ),
};

export const Boolean: Story = {
  render: () => (
    <Frame label="boolean (state strip)">
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

export const DatetimeStable: Story = {
  render: () => (
    <Frame label="datetime (relative summary)">
      <Sparkline history={samples(Array.from({ length: 18 }, () => V("datetime", now + 5 * 60 * 60 * 1000)))} />
    </Frame>
  ),
};

export const DatetimeChanged: Story = {
  render: () => (
    <Frame label="datetime (change markers)">
      <Sparkline
        history={samples([
          ...Array.from({ length: 5 }, () => V("datetime", now + 30 * 60 * 1000)),
          ...Array.from({ length: 4 }, () => V("datetime", now + 2 * 60 * 60 * 1000)),
          ...Array.from({ length: 5 }, () => V("datetime", now + 26 * 60 * 60 * 1000)),
        ])}
      />
    </Frame>
  ),
};

export const DatetimeTrackingNow: Story = {
  render: () => {
    const start = Date.now() - 11_000;
    return (
      <Frame label="datetime (tracking now)">
        <Sparkline history={Array.from({ length: 12 }, (_, i) => ({ value: V("datetime", start + i * 1000), t: start + i * 1000 }))} />
      </Frame>
    );
  },
};

export const NonNumeric: Story = {
  render: () => (
    <Frame label="string enum (HA-style state bar)">
      <Sparkline
        history={samples([
          V("str", "home"),
          V("str", "home"),
          V("str", "away"),
          V("str", "away"),
          V("str", "sleep"),
          V("str", "sleep"),
          V("str", "home"),
          V("str", "guest"),
          V("str", "guest"),
          V("str", "home"),
        ])}
      />
    </Frame>
  ),
};

export const ComplexValue: Story = {
  render: () => (
    <Frame label="object/array summary">
      <Sparkline
        history={samples([
          V("any", { mode: "auto", setpoint: 19 }),
          V("any", { mode: "auto", setpoint: 19 }),
          V("any", { mode: "boost", setpoint: 22 }),
          V("any", ["living_room", "kitchen"]),
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
      <Frame label="duration"><Sparkline history={samples([20, 40, 80, 60, 120, 300].map((s) => V("duration", s)))} /></Frame>
      <Frame label="boolean"><Sparkline history={samples([true, false, true, true, false, true].map((b) => V("bool", b)))} /></Frame>
      <Frame label="datetime"><Sparkline history={samples(Array.from({ length: 10 }, () => V("datetime", now + 90 * 60 * 1000)))} /></Frame>
      <Frame label="string"><Sparkline history={samples([V("str", "home"), V("str", "away"), V("str", "away"), V("str", "sleep"), V("str", "home")])} /></Frame>
      <Frame label="empty"><Sparkline history={[]} /></Frame>
    </div>
  ),
};
