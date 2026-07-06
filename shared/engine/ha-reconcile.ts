import type { EntityMap } from "../entities.js";
import type { ServiceCall } from "../results.js";
import { hexToRgb, type RWValue } from "../value.js";

export interface DesiredLightState {
  on: RWValue | null;
  color?: RWValue | null;
  /** Color temperature in Kelvin. Ignored when an RGB color is also desired — a light applies one. */
  temperature?: RWValue | null;
  brightness?: RWValue | null;
}

export interface DesiredClimateState {
  temperature?: RWValue | null;
  hvac_mode?: RWValue | null;
}

export interface DesiredCoverState {
  position?: RWValue | null;
  open?: RWValue | null;
}

export interface DesiredInputHelperState {
  value: RWValue | null;
}

function entity(entities: EntityMap, entity_id: string) {
  return entities[entity_id];
}

function rgbMatches(actual: unknown, want: [number, number, number]): boolean {
  return Array.isArray(actual) && actual.length >= 3 && want.every((v, i) => Number(actual[i]) === v);
}

function brightnessMatches(actual: unknown, want: unknown): boolean {
  return Number(actual) === Number(want);
}

// A light's current color temperature in Kelvin, taken from `color_temp_kelvin` when present or
// converted from the legacy `color_temp` (mireds) otherwise.
function actualKelvin(attributes: Record<string, unknown>): number | undefined {
  const kelvin = Number(attributes.color_temp_kelvin);
  if (Number.isFinite(kelvin)) return kelvin;
  const mireds = Number(attributes.color_temp);
  return Number.isFinite(mireds) && mireds > 0 ? Math.round(1e6 / mireds) : undefined;
}

export function reconcileLight(entity_id: string, desired: DesiredLightState, entities: EntityMap): ServiceCall | null {
  const on = desired.on;
  if (!on) return null;

  const e = entity(entities, entity_id);
  const actualState = e ? String(e.state) : undefined;
  if (on.v === false) {
    if (actualState === "off") return null;
    return { domain: "light", service: "turn_off", data: {}, target: { entity_id } };
  }

  const data: Record<string, unknown> = {};
  let differs = actualState !== "on";
  // A light applies either an RGB color or a color temperature, not both; a wired color wins.
  const color = desired.color;
  const temperature = desired.temperature;
  if (color) {
    const want = hexToRgb(String(color.v));
    data.rgb_color = want;
    if (!e || !rgbMatches(e.attributes.rgb_color, want)) differs = true;
  } else if (temperature) {
    const want = Math.round(Number(temperature.v));
    data.color_temp_kelvin = want;
    if (!e || actualKelvin(e.attributes) !== want) differs = true;
  }
  const brightness = desired.brightness;
  if (brightness) {
    data.brightness = brightness.v;
    if (!e || !brightnessMatches(e.attributes.brightness, brightness.v)) differs = true;
  }
  if (!differs) return null;
  return { domain: "light", service: "turn_on", data, target: { entity_id } };
}

export function reconcileClimate(entity_id: string, desired: DesiredClimateState, entities: EntityMap): ServiceCall | null {
  const e = entity(entities, entity_id);
  const mode = desired.hvac_mode;
  if (mode) {
    const actual = e ? String(e.state) : undefined;
    if (actual !== String(mode.v)) {
      return { domain: "climate", service: "set_hvac_mode", data: { hvac_mode: mode.v }, target: { entity_id } };
    }
  }
  const temp = desired.temperature;
  if (temp) {
    const actual = e ? Number(e.attributes.temperature) : undefined;
    if (actual !== Number(temp.v)) {
      return { domain: "climate", service: "set_temperature", data: { temperature: temp.v }, target: { entity_id } };
    }
  }
  return null;
}

export function reconcileCover(entity_id: string, desired: DesiredCoverState, entities: EntityMap): ServiceCall | null {
  const e = entity(entities, entity_id);
  const position = desired.position;
  if (position) {
    const want = Number(position.v);
    const actual = e ? Number(e.attributes.current_position) : undefined;
    if (actual !== want) {
      return { domain: "cover", service: "set_cover_position", data: { position: want }, target: { entity_id } };
    }
    return null;
  }
  const open = desired.open;
  if (open) {
    const want = open.v === true;
    const actual = e ? String(e.state) : undefined;
    if (want && actual !== "open") return { domain: "cover", service: "open_cover", data: {}, target: { entity_id } };
    if (!want && actual !== "closed") return { domain: "cover", service: "close_cover", data: {}, target: { entity_id } };
  }
  return null;
}

export function reconcileInputHelper(entity_id: string, desired: DesiredInputHelperState, entities: EntityMap): ServiceCall | null {
  const value = desired.value;
  if (!value) return null;
  const domain = entity_id.split(".")[0] ?? "";
  const e = entity(entities, entity_id);
  const actual = e ? String(e.state) : undefined;
  switch (domain) {
    case "input_boolean": {
      const want = value.v === true;
      if (actual !== undefined && (actual === "on") === want) return null;
      return { domain, service: want ? "turn_on" : "turn_off", data: {}, target: { entity_id } };
    }
    case "input_number": {
      const want = Number(value.v);
      if (actual !== undefined && Number(actual) === want) return null;
      return { domain, service: "set_value", data: { value: want }, target: { entity_id } };
    }
    case "input_select": {
      const want = String(value.v);
      if (actual === want) return null;
      return { domain, service: "select_option", data: { option: want }, target: { entity_id } };
    }
    case "input_text":
    default: {
      const want = String(value.v);
      if (actual === want) return null;
      return { domain: domain || "input_text", service: "set_value", data: { value: want }, target: { entity_id } };
    }
  }
}
