import type { TwilightBoundary } from "./twilight.js";

/** Domain-level value kinds. This module has no presentation or DOM dependencies. */
export type ValueType = "bool" | "num" | "str" | "color" | "duration" | "datetime" | "any";

/** The JavaScript payload carried by each concrete wire type. */
export interface ValuePayloadMap {
  bool: boolean;
  num: number;
  str: string;
  color: string;
  duration: number;
  datetime: number;
  any: unknown;
}

/** A runtime pin contains only evaluation semantics, never canvas geometry or styling. */
export interface RuntimePin {
  id: string;
  label: string;
  type: ValueType;
  unit?: string;
  variadic?: boolean;
  ghost?: boolean;
  missing?: string;
  editable?: boolean;
}

/** Known configuration contracts. Unknown/plugin node types retain a JSON record config. */
export interface NodeConfigByType {
  entity: { entity_id: string };
  fetch: { url: string; interval?: number; path?: string; as: ValueType };
  compare: { op: string };
  between: { includeMin: boolean; includeMax: boolean };
  "dt-shift": { dir: "plus" | "minus" };
  "time-of-day": { time: string };
  twilight: { start: TwilightBoundary; end: TwilightBoundary };
  duration: { unit: "ms" | "sec" | "min" | "hr" | "day" };
  "sink-call": { entity_id: string; domain: string; service: string; service_off?: string };
  "sink-light": { entity_id: string };
  "sink-climate": { entity_id: string };
  "sink-cover": { entity_id: string };
  "sink-input": { entity_id: string };
  "sink-notify": { service: string };
  "sink-tts": { entity_id: string; service?: string };
  toggle: { initial?: boolean; persistence?: "seed-at-boot" | "durable" | "reseed-from-world"; entity_id?: string };
  hold: { initial?: unknown; persistence?: "seed-at-boot" | "durable" | "reseed-from-world"; entity_id?: string };
  fold: { initial?: number; op?: "sum" | "count" | "min" | "max"; persistence?: "seed-at-boot" | "durable" | "reseed-from-world" };
  scan: { initial?: number; op?: "sum" | "count" | "min" | "max"; persistence?: "seed-at-boot" | "durable" | "reseed-from-world" };
  edge: { persistence?: "seed-at-boot" | "durable" | "reseed-from-world"; entity_id?: string };
  rising: { persistence?: "seed-at-boot" | "durable" | "reseed-from-world"; entity_id?: string };
  falling: { persistence?: "seed-at-boot" | "durable" | "reseed-from-world"; entity_id?: string };
  macro: { macroId: string };
}

export type NodeConfigFor<TType extends string> =
  TType extends keyof NodeConfigByType ? NodeConfigByType[TType] : Record<string, unknown>;

interface RuntimeNodeBase<TType extends string> {
  id: string;
  type: TType;
  inputs: RuntimePin[];
  outputs: RuntimePin[];
  stateful?: boolean;
  values?: Record<string, unknown>;
  typeGroup?: string[];
}

type RuntimeNodeConfig<TType extends string> = TType extends keyof NodeConfigByType
  ? { config: NodeConfigFor<TType> }
  : { config?: NodeConfigFor<TType> };

/**
 * The deploy/evaluator model: stable identities, pins, config, literals, and state policy only.
 * Known node kinds require their typed config; the broad `string` default remains the explicit
 * decode/registry compatibility boundary for persisted or plugin-authored nodes.
 */
export type RuntimeNode<TType extends string = string> = RuntimeNodeBase<TType> & RuntimeNodeConfig<TType>;
