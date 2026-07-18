import { type MockHA } from "../ha/mock.js";

/**
 * Drives a MockHA with changing entity states so the editor has something live to show
 * without a real Home Assistant: the sun's elevation sweeps across the horizon and the
 * room presence sensor flips. The lights advertise different capabilities (full color,
 * tunable white, on/off only) so a light sink tailors its inputs to whichever is picked.
 * light.bedroom intentionally exposes no `brightness` attribute, demonstrating a ghost pin
 * downstream.
 */
export function startSimulator(ha: MockHA): () => void {
  let phase = 0;
  ha.setState("light.living_room", "on", {
    supported_color_modes: ["color_temp", "rgb"], supported_features: 32, color_mode: "rgb", brightness: 200, rgb_color: [255, 59, 48],
    color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500,
  });
  ha.setState("light.desk", "on", {
    supported_color_modes: ["color_temp"], supported_features: 32, color_mode: "color_temp", brightness: 180,
    color_temp_kelvin: 4000, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500,
  });
  ha.setState("light.porch", "off", { supported_color_modes: ["onoff"] });
  ha.setState("light.bedroom", "on", {});
  const id = setInterval(() => {
    phase += 0.06;
    const elevation = Math.round(Math.sin(phase) * 15 * 10) / 10;
    const azimuth = Math.round((180 + Math.sin(phase * 0.5) * 40) * 10) / 10;
    ha.setState("sun.sun", elevation < 0 ? "below_horizon" : "above_horizon", { elevation, azimuth });
    ha.setState("binary_sensor.room_presence", Math.sin(phase * 0.37) > -0.5 ? "on" : "off");
  }, 250);
  return () => clearInterval(id);
}
