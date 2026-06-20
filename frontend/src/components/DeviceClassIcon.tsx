import type { IconName } from "../../../shared/node-types.js";
import { Icon } from "./Icon.js";

// Home Assistant device classes mapped to a glyph. Several classes share a glyph where they read
// the same way at a glance (a garage door is a door, a gas reading is a power-style flow). Classes
// without an entry render no symbol.
const DEVICE_CLASS_ICON: Record<string, IconName> = {
  motion: "motion",
  moving: "motion",
  vibration: "motion",
  occupancy: "occupancy",
  presence: "occupancy",
  door: "door",
  garage_door: "door",
  opening: "door",
  lock: "door",
  window: "window",
  temperature: "temperature",
  humidity: "humidity",
  moisture: "humidity",
  power: "power",
  current: "power",
  voltage: "power",
  gas: "power",
  energy: "energy",
  battery: "battery",
  timestamp: "timestamp",
  duration: "duration",
  illuminance: "illuminance",
  pressure: "pressure",
  atmospheric_pressure: "pressure",
  connectivity: "connectivity",
  signal_strength: "connectivity",
  update: "connectivity",
};

/** The glyph name for a device class, or undefined when none is known. */
export function deviceClassIconName(deviceClass: unknown): IconName | undefined {
  if (typeof deviceClass !== "string") return undefined;
  return DEVICE_CLASS_ICON[deviceClass.toLowerCase()];
}

/**
 * A small symbol standing for an entity's device class, shown next to its value. Renders nothing
 * when the class is unknown so the surrounding layout is unaffected.
 */
export function DeviceClassIcon({ deviceClass, size = 13 }: { deviceClass: unknown; size?: number }) {
  const name = deviceClassIconName(deviceClass);
  if (!name) return null;
  return (
    <span className="text-rw-faint flex shrink-0" title={String(deviceClass)}>
      <Icon name={name} size={size} />
    </span>
  );
}
