import type { Meta, StoryObj } from "@storybook/react";
import { DeviceClassIcon, deviceClassIconName } from "./DeviceClassIcon.js";
import { ValueChip } from "./ValueChip.js";
import { V } from "../../../shared/value.js";

const meta: Meta<typeof DeviceClassIcon> = {
  title: "Nodes/DeviceClassIcon",
  component: DeviceClassIcon,
};
export default meta;

type Story = StoryObj<typeof DeviceClassIcon>;

// One representative entity per glyph: the device class, the value chip it sits beside, and an
// optional unit, mirroring how an entity node's state row reads on the canvas.
const ENTITY_ROWS: { deviceClass: string; value: ReturnType<typeof V>; unit?: string }[] = [
  { deviceClass: "motion", value: V("bool", true) },
  { deviceClass: "occupancy", value: V("bool", false) },
  { deviceClass: "door", value: V("bool", true) },
  { deviceClass: "window", value: V("bool", false) },
  { deviceClass: "temperature", value: V("num", 21.4), unit: "°C" },
  { deviceClass: "humidity", value: V("num", 48), unit: "%" },
  { deviceClass: "power", value: V("num", 1240), unit: "W" },
  { deviceClass: "energy", value: V("num", 8.6), unit: "kWh" },
  { deviceClass: "battery", value: V("num", 87), unit: "%" },
  { deviceClass: "illuminance", value: V("num", 320), unit: "lx" },
  { deviceClass: "pressure", value: V("num", 1013), unit: "hPa" },
  { deviceClass: "timestamp", value: V("datetime", Date.UTC(2026, 5, 15, 12, 3, 0)) },
  { deviceClass: "duration", value: V("duration", 5400) },
  { deviceClass: "connectivity", value: V("bool", true) },
];

/** A single entity-node state row: label, device-class symbol, then the value chip. */
function ValueRow({ deviceClass, value, unit }: (typeof ENTITY_ROWS)[number]) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, minWidth: 240 }}>
      <span style={{ color: "var(--rw-faint)", fontSize: 11, marginRight: "auto" }}>{deviceClass}</span>
      <span style={{ color: "var(--rw-dim)", fontSize: 11 }}>state</span>
      <DeviceClassIcon deviceClass={deviceClass} />
      <ValueChip value={value} unit={unit} />
    </div>
  );
}

export const ValueRows: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {ENTITY_ROWS.map((r) => (
        <ValueRow key={r.deviceClass} {...r} />
      ))}
    </div>
  ),
};

export const UnknownClassRendersNothing: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ValueRow deviceClass="state class with no symbol" value={V("str", "auto")} />
      <p style={{ color: "var(--rw-faint)", fontSize: 11 }}>
        deviceClassIconName("nonsense") = {String(deviceClassIconName("nonsense"))}
      </p>
    </div>
  ),
};
