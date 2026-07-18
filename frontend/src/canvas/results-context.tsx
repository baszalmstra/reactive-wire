import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { emptyResults, type EvalResults, type SinkAction, type ServiceCall } from "../../../shared/results.js";
import type { EntityMap, EntityState } from "../../../shared/entities.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { RWValue } from "../../../shared/value.js";
import { pinKey } from "../../../shared/identity.js";
import { createRecord } from "../../../shared/record.js";

export interface ResultsCtx {
  results: EvalResults;
  actuating: boolean;
  /** The live entity feed, used to read per-entity metadata such as device_class. */
  entities: EntityMap;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onSetValue: (id: string, pin: string, value: unknown) => void;
}

interface ResultsStore {
  getSnapshot: () => ResultsCtx;
  subscribe: (listener: () => void) => () => void;
  setValue: (value: ResultsCtx) => void;
}

const EMPTY_CONTEXT: ResultsCtx = {
  results: emptyResults(),
  actuating: false,
  entities: {},
  onConfig: () => {},
  onSetValue: () => {},
};

function createResultsStore(initial: ResultsCtx): ResultsStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setValue: (value) => {
      if (Object.is(value, current)) return;
      current = value;
      for (const listener of listeners) listener();
    },
  };
}

const DEFAULT_STORE = createResultsStore(EMPTY_CONTEXT);
const Ctx = createContext<ResultsStore>(DEFAULT_STORE);

/** Stable provider: changing evaluation data notifies selector subscribers instead of the context tree. */
export function ResultsProvider({ value, children }: { value: ResultsCtx; children: ReactNode }) {
  const storeRef = useRef<ResultsStore | null>(null);
  if (!storeRef.current) storeRef.current = createResultsStore(value);
  useLayoutEffect(() => storeRef.current!.setValue(value), [value]);
  return <Ctx.Provider value={storeRef.current}>{children}</Ctx.Provider>;
}

export const useResults = (): ResultsCtx => {
  const store = useContext(Ctx);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
};

function sameValue(a: RWValue | null | undefined, b: RWValue | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.status !== b.status || a.type !== b.type) return false;
  if (a.status === "ok" && b.status === "ok") return Object.is(a.v, b.v);
  if (a.status === "error" && b.status === "error") return a.msg === b.msg;
  return true;
}

function sameAction(a: SinkAction | undefined, b: SinkAction | undefined): boolean {
  return a === b || (!!a && !!b && a.call === b.call && a.note === b.note && a.status === b.status
    && a.lastCall === b.lastCall && a.lastTriggeredAt === b.lastTriggeredAt);
}

function sameCall(a: ServiceCall | null | undefined, b: ServiceCall | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.domain !== b.domain || a.service !== b.service
    || a.target?.entity_id !== b.target?.entity_id) return false;
  const ak = Object.keys(a.data);
  const bk = Object.keys(b.data);
  return ak.length === bk.length && ak.every((key) => Object.hasOwn(b.data, key) && Object.is(a.data[key], b.data[key]));
}

interface NodeSelection extends ResultsCtx {
  deviceClass: unknown;
}

function selectNode(source: ResultsCtx, nodeId: string, def: NodeData): NodeSelection {
  const results = emptyResults();
  for (const pin of def.inputs) {
    const key = pinKey(nodeId, pin.id);
    results.inputs[key] = source.results.inputs[key] ?? null;
    results.connected[key] = source.results.connected[key] ?? false;
  }
  for (const pin of def.outputs) {
    const key = pinKey(nodeId, pin.id);
    const value = source.results.outputs[key];
    if (value) results.outputs[key] = value;
  }
  results.health[nodeId] = source.results.health[nodeId] ?? "ok";
  const action = source.results.actions[nodeId];
  if (action) results.actions[nodeId] = action;
  if (Object.hasOwn(source.results.sinks, nodeId)) results.sinks[nodeId] = source.results.sinks[nodeId] ?? null;

  const entities = createRecord<EntityState>();
  const entityId = def.type === "entity" ? String(def.config?.entity_id ?? "") : "";
  const entity = entityId ? source.entities[entityId] : undefined;
  if (entity) entities[entityId] = entity;
  return {
    results,
    actuating: source.actuating,
    entities,
    onConfig: source.onConfig,
    onSetValue: source.onSetValue,
    deviceClass: entity?.attributes?.device_class,
  };
}

function sameSelection(a: NodeSelection, b: NodeSelection, nodeId: string, def: NodeData): boolean {
  if (a.actuating !== b.actuating || a.onConfig !== b.onConfig || a.onSetValue !== b.onSetValue
    || !Object.is(a.deviceClass, b.deviceClass) || a.results.health[nodeId] !== b.results.health[nodeId]
    || !sameAction(a.results.actions[nodeId], b.results.actions[nodeId])
    || !sameCall(a.results.sinks[nodeId], b.results.sinks[nodeId])) return false;
  for (const pin of def.inputs) {
    const key = pinKey(nodeId, pin.id);
    if (a.results.connected[key] !== b.results.connected[key]
      || !sameValue(a.results.inputs[key], b.results.inputs[key])) return false;
  }
  for (const pin of def.outputs) {
    const key = pinKey(nodeId, pin.id);
    if (!sameValue(a.results.outputs[key], b.results.outputs[key])) return false;
  }
  return true;
}

/** Subscribe to only the values and entity metadata rendered by one canvas node. */
export function useNodeResults(nodeId: string, def: NodeData): ResultsCtx {
  const store = useContext(Ctx);
  const cached = useRef<NodeSelection | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selectNode(store.getSnapshot(), nodeId, def);
    if (cached.current && sameSelection(cached.current, next, nodeId, def)) return cached.current;
    cached.current = next;
    return next;
  }, [store, nodeId, def]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
