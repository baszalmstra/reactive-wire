import {} from "../ha/mock.js";
/**
 * Drives a MockHA with changing entity states so the editor has something live to show
 * without a real Home Assistant: the sun's elevation sweeps across the horizon and the
 * room presence sensor flips. light.bedroom intentionally exposes no `brightness`
 * attribute, demonstrating a ghost pin downstream.
 */
export function startSimulator(ha) {
    let phase = 0;
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
