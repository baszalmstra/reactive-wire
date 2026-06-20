import type { EntityMap } from "../../../shared/entities.js";

/**
 * A simulated entity map for the offline demo: the sun's elevation sweeps across the
 * horizon and the room presence sensor flips. light.bedroom exposes no `brightness`
 * attribute, demonstrating a ghost pin.
 */
export function simulate(phase: number): EntityMap {
  const elevation = Math.round(Math.sin(phase) * 15 * 10) / 10;
  const azimuth = Math.round((180 + Math.sin(phase * 0.5) * 40) * 10) / 10;
  const presence = Math.sin(phase * 0.37) > -0.5;
  return {
    "sun.sun": { state: elevation < 0 ? "below_horizon" : "above_horizon", attributes: { elevation, azimuth } },
    "binary_sensor.room_presence": { state: presence ? "on" : "off", attributes: { device_class: "occupancy" } },
    "light.bedroom": { state: "on", attributes: {} },
  };
}
