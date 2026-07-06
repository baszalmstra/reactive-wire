import type { EntityMap } from "../../../shared/entities.js";

/**
 * A simulated entity map for the offline demo: the sun's elevation sweeps across the
 * horizon and the room presence sensor flips. The lights advertise different capabilities —
 * a full-color bulb, a tunable-white bulb, and an on/off-only bulb — so a light sink tailors
 * its inputs to whichever is picked. light.bedroom exposes no `brightness` attribute,
 * demonstrating a ghost pin.
 */
export function simulate(phase: number): EntityMap {
  const elevation = Math.round(Math.sin(phase) * 15 * 10) / 10;
  const azimuth = Math.round((180 + Math.sin(phase * 0.5) * 40) * 10) / 10;
  const presence = Math.sin(phase * 0.37) > -0.5;
  return {
    "sun.sun": { state: elevation < 0 ? "below_horizon" : "above_horizon", attributes: { elevation, azimuth } },
    "binary_sensor.room_presence": { state: presence ? "on" : "off", attributes: { device_class: "occupancy" } },
    "light.living_room": {
      state: "on",
      attributes: {
        supported_color_modes: ["color_temp", "rgb"], color_mode: "rgb", brightness: 200, rgb_color: [255, 59, 48],
        color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500,
      },
    },
    "light.desk": {
      state: "on",
      attributes: {
        supported_color_modes: ["color_temp"], color_mode: "color_temp", brightness: 180,
        color_temp_kelvin: 4000, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500,
      },
    },
    "light.porch": { state: "off", attributes: { supported_color_modes: ["onoff"] } },
    "light.bedroom": { state: "on", attributes: {} },
  };
}
