import type { Meta, StoryObj } from "@storybook/react";
import { ValueChip } from "./ValueChip.js";
import { V, UN, ER, ST } from "../../../shared/value.js";

const meta: Meta<typeof ValueChip> = {
  title: "Nodes/ValueChip",
  component: ValueChip,
};
export default meta;

type Story = StoryObj<typeof ValueChip>;

const Row = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
);

export const AllTypes: Story = {
  render: () => (
    <Row>
      <ValueChip value={V("bool", true)} />
      <ValueChip value={V("bool", false)} />
      <ValueChip value={V("num", -4.2)} unit="°" />
      <ValueChip value={V("str", "below_horizon")} />
      <ValueChip value={V("color", "#ff3b30")} />
      <ValueChip value={V("duration", 600)} />
      <ValueChip value={V("duration", 5400)} />
      <ValueChip value={V("datetime", Date.UTC(2026, 5, 15, 12, 3, 0))} />
    </Row>
  ),
};

export const NonOkStates: Story = {
  render: () => (
    <Row>
      <ValueChip value={UN("num")} />
      <ValueChip value={ER("bool")} />
      <ValueChip value={ST("num", 21.3)} />
      <ValueChip value={null} />
    </Row>
  ),
};

export const Anatomies: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Row>
        <span style={{ color: "var(--rw-faint)", fontSize: 11, width: 64 }}>chips</span>
        <ValueChip value={V("num", 21.3)} anatomy="chips" />
        <ValueChip value={V("bool", true)} anatomy="chips" />
      </Row>
      <Row>
        <span style={{ color: "var(--rw-faint)", fontSize: 11, width: 64 }}>inset</span>
        <ValueChip value={V("num", 21.3)} anatomy="inset" />
        <ValueChip value={V("bool", true)} anatomy="inset" />
      </Row>
      <Row>
        <span style={{ color: "var(--rw-faint)", fontSize: 11, width: 64 }}>minimal</span>
        <ValueChip value={V("num", 21.3)} anatomy="minimal" />
        <ValueChip value={V("bool", true)} anatomy="minimal" />
      </Row>
    </div>
  ),
};
