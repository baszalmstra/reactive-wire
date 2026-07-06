import type { PinDef } from "../node-types.js";
import { rgbToHex } from "../value.js";

/** What dimensions a Home Assistant light can actually be driven on. */
export interface LightCaps {
  brightness: boolean;
  rgb: boolean;
  colorTemp: boolean;
  /** The color-temperature bounds in Kelvin, when the light reports them. */
  minKelvin?: number;
  maxKelvin?: number;
}

// Color modes that carry an RGB-style color. `onoff` carries neither color nor brightness;
// every other mode carries brightness.
const RGB_MODES = new Set(["hs", "rgb", "rgbw", "rgbww", "xy"]);

// Legacy supported_features bits, for lights that predate supported_color_modes.
const SF_BRIGHTNESS = 1;
const SF_COLOR_TEMP = 2;
const SF_COLOR = 16;

function kelvinBounds(attributes: Record<string, unknown>): { minKelvin?: number; maxKelvin?: number } {
  const min = Number(attributes.min_color_temp_kelvin);
  const max = Number(attributes.max_color_temp_kelvin);
  const out: { minKelvin?: number; maxKelvin?: number } = {};
  if (Number.isFinite(min)) out.minKelvin = min;
  if (Number.isFinite(max)) out.maxKelvin = max;
  return out;
}

/**
 * Read a light's capabilities from its attributes. Prefers the modern `supported_color_modes` list
 * and falls back to the legacy `supported_features` bitmask. Returns null when the attributes carry
 * neither — capabilities are then unknown, and the caller keeps a permissive default rather than
 * hiding dimensions the light might support.
 */
export function lightCaps(attributes: Record<string, unknown> | undefined): LightCaps | null {
  if (!attributes) return null;
  const modes = Array.isArray(attributes.supported_color_modes)
    ? attributes.supported_color_modes.map((m) => String(m).toLowerCase())
    : null;
  if (modes && modes.length) {
    return {
      brightness: modes.some((m) => m !== "onoff" && m !== "unknown"),
      rgb: modes.some((m) => RGB_MODES.has(m)),
      colorTemp: modes.includes("color_temp"),
      ...kelvinBounds(attributes),
    };
  }
  const sf = Number(attributes.supported_features);
  if (Number.isFinite(sf) && sf > 0) {
    return {
      brightness: (sf & SF_BRIGHTNESS) !== 0,
      rgb: (sf & SF_COLOR) !== 0,
      colorTemp: (sf & SF_COLOR_TEMP) !== 0,
      ...kelvinBounds(attributes),
    };
  }
  return null;
}

/**
 * The input pins a light sink should expose for a light with the given capabilities: `on` always,
 * then only the color/temperature/brightness dimensions the light actually supports. Unknown
 * capabilities (null) keep the permissive default of color + brightness so the sink stays usable.
 */
export function lightSinkPins(caps: LightCaps | null): PinDef[] {
  const pins: PinDef[] = [{ id: "on", label: "on", type: "bool", editable: true }];
  if (!caps || caps.rgb) pins.push({ id: "color", label: "color", type: "color", editable: true });
  if (caps?.colorTemp) pins.push({ id: "temperature", label: "temperature", type: "num", unit: "K", editable: true });
  if (!caps || caps.brightness) pins.push({ id: "brightness", label: "brightness", type: "num", editable: true });
  return pins;
}

function clearGhost(pin: PinDef): PinDef {
  const { ghost: _ghost, missing: _missing, ...rest } = pin;
  return rest;
}

/**
 * Reshape a light sink's stored input pins to match a light's capabilities, preserving edits and
 * wires: a supported pin already present is kept (any stale ghost cleared), a newly supported pin is
 * added, and a stored pin the light no longer supports is dropped when unwired or ghosted when still
 * wired — so an unsupported-but-connected input stays visible as a problem rather than silently
 * vanishing.
 */
export function reconcileLightSinkPins(stored: PinDef[], caps: LightCaps | null, isWired: (pinId: string) => boolean): PinDef[] {
  const desired = lightSinkPins(caps);
  const desiredIds = new Set(desired.map((p) => p.id));
  const storedById = new Map(stored.map((p) => [p.id, p]));
  const out: PinDef[] = [];
  for (const pin of desired) {
    const kept = storedById.get(pin.id);
    out.push(kept ? (kept.ghost ? clearGhost(kept) : kept) : { ...pin });
  }
  for (const pin of stored) {
    if (desiredIds.has(pin.id)) continue;
    if (isWired(pin.id)) out.push({ ...pin, ghost: true, missing: pin.missing ?? pin.label ?? pin.id });
  }
  return out;
}

/**
 * Approximate the visible color of a black-body light source at a color temperature in Kelvin, as a
 * hex string — used to tint a light's preview when it is driven by temperature rather than an RGB
 * color. Based on Tanner Helland's piecewise fit, clamped to a sane 1000–40000 K range.
 */
export function kelvinToHex(kelvin: number): string {
  const t = Math.max(1000, Math.min(40000, Number(kelvin) || 6500)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return rgbToHex(c(r), c(g), c(b));
}
