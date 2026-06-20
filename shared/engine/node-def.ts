import type { IconName, NodeData, PinDef } from "../node-types.js";
import type { ValueType } from "../theme.js";
import type { EntityMap } from "../entities.js";
import type { RWValue } from "../value.js";
import type { ServiceCall } from "../results.js";
import type { NodeMemory, SourceMap } from "./engine-support.js";

/** A config field a node needs set when it's created (drives the on-drop popup). */
export interface RequiredConfig {
  field: string;
  kind: "entity";
  label: string;
  /** For entity fields, restrict the picker to these Home Assistant domains. */
  domains?: string[];
}

/** A node's palette entry: its category, label, icon, and the canonical NodeData factory. */
export interface NodeTemplate {
  type: string;
  category: string;
  label: string;
  icon: IconName;
  make: (id: string) => NodeData;
  /** If set, dropping this node opens a popup to fill this config first. */
  requires?: RequiredConfig;
}

/**
 * Everything a node's eval needs, already resolved by the shared engine. Cross-cutting machinery
 * (input resolution with editable defaults, Kleene-aware wired reads, generic/typeGroup
 * resolution, the connected pin list, memory threading, the entity map and clock) stays in the
 * engine and is handed to each node here, so a node definition only expresses its own behavior.
 */
export interface EvalCtx {
  /** The node being evaluated. */
  n: NodeData;
  /** The output pin being requested. */
  pinId: string;
  /** The node's config object (never null). */
  cfg: Record<string, unknown>;
  /** The node's input pins that currently have an incoming edge (for variadic folding). */
  conn: PinDef[];
  /** The wired value of an input pin, or null when nothing is connected. */
  inVal: (pinId: string) => RWValue | null;
  /** The effective value of an input pin: wired if connected, else its editable default (or null). */
  inEff: (pinId: string) => RWValue | null;
  /** Resolve an "any" output type from the first connected fallback input pin's type. */
  resolveType: (declared: ValueType, fallbackPins: string[]) => ValueType;
  /** The shared type of the node's generic pins, taken from whichever group pin is connected. */
  resolveGroupType: (fallback: ValueType) => ValueType;
  /** Establish (once) and return a boolean stateful node's memory slot, honoring its policy. */
  seedBool: () => NodeMemory;
  /** This node's own memory slot, created on first access. */
  mem: () => NodeMemory;
  /** The live entity map. */
  entities: EntityMap;
  /** The current time as epoch milliseconds. */
  now: number;
  /** The latest fetched body per node id, written by a poller outside the engine. */
  sources: SourceMap;
}

/** Everything a sink's evalSink needs to build its desired service call. */
export interface SinkCtx {
  /** The sink node. */
  n: NodeData;
  /** The node's config object (never null). */
  cfg: Record<string, unknown>;
  /** An input pin's ok value, or null when it is unset / non-ok. */
  okInput: (pinId: string) => RWValue | null;
  /** The live entity map (for reconciling diffs). */
  entities: EntityMap;
  /** This node's own memory slot, created on first access (for edge-triggered transients). */
  mem: () => NodeMemory;
}

/**
 * A self-contained definition of one node type: its palette template, its one-line description,
 * and a pure eval that returns the requested output pin's value. Sinks add evalSink (the desired
 * service call), a gate pin (the input that blocks actuation when non-ok), and a transient flag.
 */
export interface NodeDef {
  /** The node type string this definition dispatches for. */
  type: string;
  /** Palette presentation and the canonical NodeData factory. */
  template: NodeTemplate;
  /** One-line explanation shown in the palette and inspector. */
  description: string;
  /** Compute the value of one output pin from already-resolved inputs. */
  eval: (ctx: EvalCtx) => RWValue;
  /** For sinks: the service call to make right now, or null to hold. */
  evalSink?: (ctx: SinkCtx) => ServiceCall | null;
  /** For sinks: the input pin whose non-ok value blocks the call entirely, if any. */
  sinkGatePin?: string;
  /** For sinks: an edge-triggered transient (notify/tts) the caller must not also de-dupe. */
  transient?: boolean;
}
