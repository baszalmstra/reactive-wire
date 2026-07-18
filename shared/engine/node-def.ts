import type { IconName, NodeData } from "../node-types.js";
import type { NodeConfigFor, RuntimeNode, RuntimePin, ValueType } from "../runtime-types.js";
import type { EntityMap } from "../entities.js";
import type { RWValue } from "../value.js";
import type { ServiceCall } from "../results.js";
import type { NodeMemory, SourceMap } from "./engine-support.js";
import { createRecord, setOwn } from "../record.js";

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

/** One node's complete, atomic proposal for the current evaluation transaction. */
export interface NodeEvaluation {
  /** Every declared output, keyed by pin id, from one coherent input/environment snapshot. */
  outputs: Record<string, RWValue>;
  /** Replacement memory committed only if the whole graph transaction succeeds. */
  nextMemory?: NodeMemory;
}

/** One sink's call and optional atomic memory proposal. */
export interface SinkEvaluation {
  call: ServiceCall | null;
  nextMemory?: NodeMemory;
}

/**
 * Everything a node's eval needs, already resolved by the shared engine. Cross-cutting machinery
 * stays in the engine. Memory is read-only previous-transaction state; definitions propose a
 * replacement through NodeEvaluation rather than mutating the caller's memory during evaluation.
 */
export interface EvalCtx<TType extends string = string> {
  n: RuntimeNode<TType>;
  cfg: NodeConfigFor<TType>;
  conn: RuntimePin[];
  inVal: (pinId: string) => RWValue | null;
  inEff: (pinId: string) => RWValue | null;
  resolveType: (declared: ValueType, fallbackPins: string[]) => ValueType;
  resolveGroupType: (fallback: ValueType) => ValueType;
  /** A fresh boolean seed proposal derived from previous memory, config, and current world. */
  seedBool: () => NodeMemory;
  /** This node's memory from the last committed transaction. Never mutate it. */
  previousMemory: Readonly<NodeMemory>;
  entities: EntityMap;
  now: number;
  sources: SourceMap;
}

/** Everything a sink's evalSink needs to build its desired service call. */
export interface SinkCtx<TType extends string = string> {
  n: RuntimeNode<TType>;
  cfg: NodeConfigFor<TType>;
  okInput: (pinId: string) => RWValue | null;
  entities: EntityMap;
  /** This sink's memory from the last committed transaction. Never mutate it. */
  previousMemory: Readonly<NodeMemory>;
}

/** Adapt a conventional one-output calculation to the atomic node contract. */
export function singleOutput(pinId: string, evaluate: (ctx: EvalCtx) => RWValue): (ctx: EvalCtx) => NodeEvaluation {
  return (ctx) => {
    const outputs = createRecord<RWValue>();
    setOwn(outputs, pinId, evaluate(ctx));
    return { outputs };
  };
}

/** Atomic evaluation for nodes, notably sinks, that declare no outputs. */
export function noOutputs(): NodeEvaluation {
  return { outputs: createRecord<RWValue>() };
}

/** Adapt a stateless sink call builder to the atomic sink contract. */
export function statelessSink(evaluate: (ctx: SinkCtx) => ServiceCall | null): (ctx: SinkCtx) => SinkEvaluation {
  return (ctx) => ({ call: evaluate(ctx) });
}

/** A self-contained definition of one node type. */
export interface NodeDef<TType extends string = string> {
  type: TType;
  template: NodeTemplate;
  description: string;
  /** This definition reads the transaction clock directly and must be a clock dirty root. */
  dependsOnClock?: boolean;
  /** Compute all declared outputs and proposed memory exactly once per transaction. */
  eval: (ctx: EvalCtx<TType>) => NodeEvaluation;
  /** For sinks: compute the desired call and proposed memory exactly once per transaction. */
  evalSink?: (ctx: SinkCtx<TType>) => SinkEvaluation;
  sinkGatePin?: string;
  transient?: boolean;
}
