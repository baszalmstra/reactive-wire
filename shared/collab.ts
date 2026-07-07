import * as Y from "yjs";
import type { MacroMap } from "./macros.js";

export interface CollabEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  style?: Record<string, unknown>;
}

export interface CollabNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  dragHandle?: string;
  zIndex?: number;
  data?: unknown;
  selected?: boolean;
  [key: string]: unknown;
}

export interface CollabFlow {
  id: string;
  name: string;
  nodes: CollabNode[];
  edges: CollabEdge[];
}

export interface EditorDocumentSettings {
  /** Server-owned actuation policy. When true, the server deploys enabled flows after document edits. */
  autoDeploy: boolean;
  /** Legacy single-flow deployment target, kept for older documents/clients. */
  deployFlowId?: string;
  /** Flow tabs the server should deploy and keep live. Empty means no flows are enabled. */
  deployedFlowIds?: string[];
}

export interface EditorDocumentSnapshot {
  version: 1;
  activeFlowId?: string;
  flows: CollabFlow[];
  macros: MacroMap;
  settings: EditorDocumentSettings;
}

export type DocStateMessage = { type: "docState"; update: string };
export type DocUpdateMessage = { type: "docUpdate"; update: string; token?: string };
export type DocErrorMessage = { type: "docError"; error: string };
export type CollabProtocolMessage = DocStateMessage | DocUpdateMessage | DocErrorMessage;

const VERSION = 1;
/** The editor document schema version this build reads and writes. */
export const EDITOR_DOCUMENT_VERSION = VERSION;
const DEFAULT_FLOW_ID = "flow-1";
export const DEFAULT_MAX_DOC_UPDATE_BYTES = 2_000_000;
export const DEFAULT_MAX_DOC_STATE_BYTES = 8_000_000;
const MAX_FLOWS = 64;
const MAX_NODES_PER_FLOW = 1_000;
const MAX_EDGES_PER_FLOW = 4_000;
const MAX_MACROS = 100;
const MAX_JSON_DEPTH = 8;
const MAX_ARRAY_ITEMS = 5_000;
const MAX_OBJECT_KEYS = 500;
const SAFE_KEY = /^(?!(__proto__|prototype|constructor)$).{1,200}$/;

type JsonRecord = Record<string, unknown>;

function toPlain(value: unknown): unknown {
  if (value instanceof Y.Map || value instanceof Y.Array) return value.toJSON();
  return value;
}

function isRecord(v: unknown): v is JsonRecord {
  const plain = toPlain(v);
  return typeof plain === "object" && plain !== null && !Array.isArray(plain);
}

function asRecord(v: unknown): JsonRecord | null {
  const plain = toPlain(v);
  return typeof plain === "object" && plain !== null && !Array.isArray(plain) ? plain as JsonRecord : null;
}

function safeString(v: unknown, fallback = "", max = 240): string {
  return (typeof v === "string" ? v : fallback).slice(0, max);
}

function safeJson<T = unknown>(value: T, depth = 0): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_JSON_DEPTH) return null;
  const plain = toPlain(value);
  if (Array.isArray(plain)) return plain.slice(0, MAX_ARRAY_ITEMS).map((x) => safeJson(x, depth + 1));
  const record = asRecord(plain);
  if (!record) return null;
  const out: JsonRecord = {};
  let count = 0;
  for (const [key, val] of Object.entries(record)) {
    if (!SAFE_KEY.test(key)) continue;
    if (count++ >= MAX_OBJECT_KEYS) break;
    if (key === "selected") continue;
    out[key] = safeJson(val, depth + 1);
  }
  return out;
}

function sanitizeNode(raw: unknown): CollabNode | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = safeString(record.id).trim();
  if (!id) return null;
  const node = safeJson({ ...record, id, selected: undefined }) as CollabNode;
  node.id = id;
  if (isRecord(node.position)) {
    const x = Number(node.position.x);
    const y = Number(node.position.y);
    node.position = { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
  }
  return node;
}

function sanitizeEdge(raw: unknown): CollabEdge | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = safeString(record.id).trim();
  const source = safeString(record.source).trim();
  const target = safeString(record.target).trim();
  if (!id || !source || !target) return null;
  const edge = safeJson({ ...record, id, source, target }) as CollabEdge;
  edge.id = id;
  edge.source = source;
  edge.target = target;
  return edge;
}

function sanitizeMacroMap(raw: unknown): MacroMap {
  const record = asRecord(raw);
  if (!record) return {};
  const out: MacroMap = {};
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (count++ >= MAX_MACROS) break;
    if (!SAFE_KEY.test(key) || !isRecord(value)) continue;
    const macro = safeJson(value) as MacroMap[string];
    const id = safeString((macro as { id?: unknown }).id, key).trim();
    if (!id) continue;
    out[id] = { ...macro, id };
  }
  return out;
}

function uniqueValidFlowIds(rawIds: unknown[], flowIds: Set<string>): string[] {
  const out: string[] = [];
  for (const raw of rawIds) {
    const id = safeString(raw).trim();
    if (!id || !flowIds.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

function readDeploymentFlowIds(settings: JsonRecord | null | undefined, flows: CollabFlow[], fallback: string): string[] {
  const flowIds = new Set(flows.map((f) => f.id));
  if (Array.isArray(settings?.deployedFlowIds)) return uniqueValidFlowIds(settings.deployedFlowIds, flowIds);
  const legacy = safeString(settings?.deployFlowId, fallback).trim();
  return legacy && flowIds.has(legacy) ? [legacy] : [fallback];
}

export function emptyEditorDocumentSnapshot(flowId = DEFAULT_FLOW_ID): EditorDocumentSnapshot {
  return {
    version: VERSION,
    activeFlowId: flowId,
    flows: [{ id: flowId, name: "Flow 1", nodes: [], edges: [] }],
    macros: {},
    settings: { autoDeploy: false, deployFlowId: flowId, deployedFlowIds: [flowId] },
  };
}

export function sanitizeEditorDocumentSnapshot(raw: unknown): EditorDocumentSnapshot {
  const record = asRecord(raw);
  if (!record) return emptyEditorDocumentSnapshot();
  const flowsRaw = Array.isArray(record.flows) ? record.flows.slice(0, MAX_FLOWS) : [];
  const flows: CollabFlow[] = [];
  for (const f of flowsRaw) {
    const flowRecord = asRecord(f);
    if (!flowRecord) continue;
    const id = safeString(flowRecord.id).trim();
    if (!id || flows.some((x) => x.id === id)) continue;
    const nodes = (Array.isArray(flowRecord.nodes) ? flowRecord.nodes : []).slice(0, MAX_NODES_PER_FLOW).map(sanitizeNode).filter((n): n is CollabNode => !!n);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = (Array.isArray(flowRecord.edges) ? flowRecord.edges : [])
      .slice(0, MAX_EDGES_PER_FLOW)
      .map(sanitizeEdge)
      .filter((e): e is CollabEdge => !!e && nodeIds.has(e.source) && nodeIds.has(e.target));
    flows.push({ id, name: safeString(flowRecord.name, "Flow", 80), nodes, edges });
  }
  if (flows.length === 0) flows.push(emptyEditorDocumentSnapshot().flows[0]!);
  const activeFlowId = safeString(record.activeFlowId, flows[0]!.id).trim();
  const validActiveFlowId = flows.some((f) => f.id === activeFlowId) ? activeFlowId : flows[0]!.id;
  const settingsRecord = asRecord(record.settings);
  const deployedFlowIds = readDeploymentFlowIds(settingsRecord, flows, validActiveFlowId);
  return {
    version: VERSION,
    activeFlowId: validActiveFlowId,
    flows,
    macros: sanitizeMacroMap(record.macros),
    settings: {
      autoDeploy: settingsRecord?.autoDeploy === true,
      deployFlowId: deployedFlowIds[0] ?? validActiveFlowId,
      deployedFlowIds,
    },
  };
}

function rootMaps(doc: Y.Doc): { meta: Y.Map<unknown>; flows: Y.Map<Y.Map<unknown>>; flowOrder: Y.Array<string>; macros: Y.Map<unknown> } {
  return {
    meta: doc.getMap("meta"),
    flows: doc.getMap("flows"),
    flowOrder: doc.getArray("flowOrder"),
    macros: doc.getMap("macros"),
  };
}

function flowMaps(flow: Y.Map<unknown>): { nodes: Y.Map<unknown>; nodeOrder: Y.Array<string>; edges: Y.Map<unknown>; edgeOrder: Y.Array<string> } {
  let nodes = flow.get("nodes") as Y.Map<unknown> | undefined;
  if (!(nodes instanceof Y.Map)) {
    nodes = new Y.Map<unknown>();
    flow.set("nodes", nodes);
  }
  let nodeOrder = flow.get("nodeOrder") as Y.Array<string> | undefined;
  if (!(nodeOrder instanceof Y.Array)) {
    nodeOrder = new Y.Array<string>();
    flow.set("nodeOrder", nodeOrder);
  }
  let edges = flow.get("edges") as Y.Map<unknown> | undefined;
  if (!(edges instanceof Y.Map)) {
    edges = new Y.Map<unknown>();
    flow.set("edges", edges);
  }
  let edgeOrder = flow.get("edgeOrder") as Y.Array<string> | undefined;
  if (!(edgeOrder instanceof Y.Array)) {
    edgeOrder = new Y.Array<string>();
    flow.set("edgeOrder", edgeOrder);
  }
  return { nodes, nodeOrder, edges, edgeOrder };
}

function replaceArray<T>(arr: Y.Array<T>, values: T[]): void {
  const current = arr.toArray();
  if (current.length === values.length && current.every((value, i) => Object.is(value, values[i]))) return;
  if (arr.length) arr.delete(0, arr.length);
  if (values.length) arr.push(values);
}

function safeJsonRecord(value: unknown): JsonRecord {
  const safe = safeJson(value);
  return asRecord(safe) ?? {};
}

function setMapValueIfChanged(target: Y.Map<unknown>, key: string, value: unknown): void {
  if (JSON.stringify(safeJson(target.get(key)) ?? null) !== JSON.stringify(safeJson(value) ?? null)) target.set(key, value);
}

function syncMapValue(target: Y.Map<unknown>, key: string, previous: unknown, next: unknown): void {
  const prevRecord = asRecord(previous);
  const nextRecord = asRecord(next);
  if (nextRecord) {
    let child = target.get(key) as Y.Map<unknown> | undefined;
    if (!(child instanceof Y.Map)) {
      child = new Y.Map<unknown>();
      target.set(key, child);
    }
    syncMapObject(child, prevRecord ?? {}, nextRecord);
    return;
  }
  const value = safeJson(next);
  if (JSON.stringify(safeJson(previous) ?? null) !== JSON.stringify(value)) setMapValueIfChanged(target, key, value);
}

function syncMapObject(target: Y.Map<unknown>, previous: unknown, next: unknown): void {
  const prev = safeJsonRecord(previous);
  const value = safeJsonRecord(next);
  for (const key of Object.keys(prev)) {
    if (!(key in value)) target.delete(key);
  }
  for (const [key, val] of Object.entries(value)) {
    syncMapValue(target, key, prev[key], val);
  }
}

function setObjectEntry(map: Y.Map<unknown>, id: string, previous: unknown, next: unknown): void {
  let target = map.get(id) as Y.Map<unknown> | undefined;
  if (!(target instanceof Y.Map)) {
    target = new Y.Map<unknown>();
    map.set(id, target);
  }
  syncMapObject(target, previous, next);
}

function syncOrder(order: Y.Array<string>, previousIds: Set<string>, nextIds: string[]): void {
  const existing = order.toArray();
  const keep = new Set(nextIds);
  const fromPrevious = existing.filter((id) => !previousIds.has(id) || keep.has(id));
  const merged = [...fromPrevious];
  const mergedIds = new Set(merged);
  for (const id of nextIds) {
    if (!mergedIds.has(id)) {
      merged.push(id);
      mergedIds.add(id);
    }
  }
  replaceArray(order, merged.filter((id) => keep.has(id) || !previousIds.has(id)));
}

function updateMapFromDiff<T extends { id: string }>(map: Y.Map<unknown>, order: Y.Array<string>, previous: T[], next: T[]): void {
  const prevById = new Map(previous.map((x) => [x.id, x]));
  const nextById = new Map(next.map((x) => [x.id, x]));
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) map.delete(id);
  }
  for (const item of next) {
    const old = prevById.get(item.id);
    if (JSON.stringify(old ?? null) !== JSON.stringify(item)) setObjectEntry(map, item.id, old ?? {}, item);
  }
  syncOrder(order, new Set(prevById.keys()), next.map((x) => x.id));
}

export class UnsupportedEditorDocumentVersionError extends Error {
  constructor(version: unknown) {
    super(`Unsupported editor document version: ${String(version)}`);
    this.name = "UnsupportedEditorDocumentVersionError";
  }
}

export function ensureEditorDocInitialized(doc: Y.Doc): void {
  const { meta, flows } = rootMaps(doc);
  const version = meta.get("version");
  if (flows.size === 0 && version === undefined) {
    applyEditorSnapshot(doc, emptyEditorDocumentSnapshot(), "init");
    return;
  }
  if (version !== VERSION) throw new UnsupportedEditorDocumentVersionError(version);
}

export function applyEditorSnapshot(doc: Y.Doc, rawSnapshot: unknown, origin?: unknown): EditorDocumentSnapshot {
  const snapshot = sanitizeEditorDocumentSnapshot(rawSnapshot);
  doc.transact(() => {
    const { meta, flows, flowOrder, macros } = rootMaps(doc);
    setMapValueIfChanged(meta, "version", VERSION);
    setMapValueIfChanged(meta, "activeFlowId", snapshot.activeFlowId ?? snapshot.flows[0]?.id ?? DEFAULT_FLOW_ID);
    setMapValueIfChanged(meta, "autoDeploy", snapshot.settings.autoDeploy);
    setMapValueIfChanged(meta, "deployedFlowIds", snapshot.settings.deployedFlowIds ?? [snapshot.settings.deployFlowId ?? snapshot.activeFlowId ?? snapshot.flows[0]?.id ?? DEFAULT_FLOW_ID]);
    setMapValueIfChanged(meta, "deployFlowId", snapshot.settings.deployFlowId ?? snapshot.settings.deployedFlowIds?.[0] ?? snapshot.activeFlowId ?? snapshot.flows[0]?.id ?? DEFAULT_FLOW_ID);
    for (const id of Array.from(flows.keys())) flows.delete(id);
    replaceArray(flowOrder, snapshot.flows.map((f) => f.id));
    for (const flow of snapshot.flows) {
      const yFlow = new Y.Map<unknown>();
      flows.set(flow.id, yFlow);
      setMapValueIfChanged(yFlow, "id", flow.id);
      setMapValueIfChanged(yFlow, "name", flow.name);
      const { nodes, nodeOrder, edges, edgeOrder } = flowMaps(yFlow);
      for (const node of flow.nodes) setObjectEntry(nodes, node.id, {}, node);
      replaceArray(nodeOrder, flow.nodes.map((n) => n.id));
      for (const edge of flow.edges) setObjectEntry(edges, edge.id, {}, edge);
      replaceArray(edgeOrder, flow.edges.map((e) => e.id));
    }
    for (const id of Array.from(macros.keys())) macros.delete(id);
    for (const [id, macro] of Object.entries(snapshot.macros)) setObjectEntry(macros, id, {}, macro);
  }, origin);
  return snapshot;
}

export function applyEditorSnapshotDiff(doc: Y.Doc, previousRaw: unknown, nextRaw: unknown, origin?: unknown): EditorDocumentSnapshot {
  const previous = sanitizeEditorDocumentSnapshot(previousRaw);
  const next = sanitizeEditorDocumentSnapshot(nextRaw);
  ensureEditorDocInitialized(doc);
  doc.transact(() => {
    const { meta, flows, flowOrder, macros } = rootMaps(doc);
    setMapValueIfChanged(meta, "version", VERSION);
    setMapValueIfChanged(meta, "activeFlowId", next.activeFlowId ?? next.flows[0]?.id ?? DEFAULT_FLOW_ID);
    setMapValueIfChanged(meta, "autoDeploy", next.settings.autoDeploy);
    setMapValueIfChanged(meta, "deployedFlowIds", next.settings.deployedFlowIds ?? [next.settings.deployFlowId ?? next.activeFlowId ?? next.flows[0]?.id ?? DEFAULT_FLOW_ID]);
    setMapValueIfChanged(meta, "deployFlowId", next.settings.deployFlowId ?? next.settings.deployedFlowIds?.[0] ?? next.activeFlowId ?? next.flows[0]?.id ?? DEFAULT_FLOW_ID);

    const prevFlows = new Map(previous.flows.map((f) => [f.id, f]));
    const nextFlows = new Map(next.flows.map((f) => [f.id, f]));
    for (const id of prevFlows.keys()) if (!nextFlows.has(id)) flows.delete(id);
    for (const flow of next.flows) {
      let yFlow = flows.get(flow.id) as Y.Map<unknown> | undefined;
      if (!(yFlow instanceof Y.Map)) {
        yFlow = new Y.Map<unknown>();
        flows.set(flow.id, yFlow);
      }
      setMapValueIfChanged(yFlow, "id", flow.id);
      setMapValueIfChanged(yFlow, "name", flow.name);
      const { nodes, nodeOrder, edges, edgeOrder } = flowMaps(yFlow);
      const prevFlow = prevFlows.get(flow.id) ?? { nodes: [], edges: [] };
      updateMapFromDiff(nodes, nodeOrder, prevFlow.nodes, flow.nodes);
      updateMapFromDiff(edges, edgeOrder, prevFlow.edges, flow.edges);
    }
    syncOrder(flowOrder, new Set(prevFlows.keys()), next.flows.map((f) => f.id));

    const prevMacros = sanitizeMacroMap(previous.macros);
    for (const id of Object.keys(prevMacros)) if (!(id in next.macros)) macros.delete(id);
    for (const [id, macro] of Object.entries(next.macros)) {
      if (JSON.stringify(prevMacros[id] ?? null) !== JSON.stringify(macro)) setObjectEntry(macros, id, prevMacros[id] ?? {}, macro);
    }
  }, origin);
  return next;
}

function orderedValues<T extends { id: string }>(map: Y.Map<unknown>, order: Y.Array<string>, sanitize: (v: unknown) => T | null): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order.toArray()) {
    const item = sanitize(map.get(id));
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  for (const [id, value] of Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (seen.has(id)) continue;
    const item = sanitize(value);
    if (item) out.push(item);
  }
  return out;
}

/** The version stamped into a document's meta map, or undefined for an uninitialized doc. */
export function readEditorDocumentVersion(doc: Y.Doc): unknown {
  return doc.getMap("meta").get("version");
}

/**
 * Read a document's snapshot without enforcing the version. The CRDT map structure is
 * version-stable — only the JSON payloads inside nodes change across versions — so this lifts an
 * older-than-current doc into a snapshot the migration registry can then transform. The strict
 * snapshotFromEditorDoc stays the reader for current-version docs; use this only on the migration
 * path where the version guard would reject a doc that is meant to be upgraded.
 */
export function readEditorDocumentSnapshotUnchecked(doc: Y.Doc): EditorDocumentSnapshot {
  return readEditorDocSnapshot(doc);
}

export function snapshotFromEditorDoc(doc: Y.Doc): EditorDocumentSnapshot {
  ensureEditorDocInitialized(doc);
  return readEditorDocSnapshot(doc);
}

function readEditorDocSnapshot(doc: Y.Doc): EditorDocumentSnapshot {
  const { meta, flows, flowOrder, macros } = rootMaps(doc);
  const seen = new Set<string>();
  const outFlows: CollabFlow[] = [];
  const readFlow = (id: string): void => {
    const yFlow = flows.get(id);
    if (!(yFlow instanceof Y.Map) || seen.has(id)) return;
    seen.add(id);
    const { nodes, nodeOrder, edges, edgeOrder } = flowMaps(yFlow);
    const outNodes = orderedValues(nodes, nodeOrder, sanitizeNode).slice(0, MAX_NODES_PER_FLOW);
    const nodeIds = new Set(outNodes.map((n) => n.id));
    outFlows.push({
      id,
      name: safeString(yFlow.get("name"), "Flow", 80),
      nodes: outNodes,
      edges: orderedValues(edges, edgeOrder, sanitizeEdge).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)).slice(0, MAX_EDGES_PER_FLOW),
    });
  };
  for (const id of flowOrder.toArray()) readFlow(id);
  for (const id of Array.from(flows.keys()).sort()) readFlow(id);
  const macroObj: MacroMap = {};
  for (const [id, value] of Array.from(macros.entries()).slice(0, MAX_MACROS)) {
    const sanitized = sanitizeMacroMap({ [id]: value });
    Object.assign(macroObj, sanitized);
  }
  const fallback = outFlows[0]?.id ?? DEFAULT_FLOW_ID;
  const activeFlowId = safeString(meta.get("activeFlowId"), fallback);
  const snapshotFlows = outFlows.length ? outFlows : emptyEditorDocumentSnapshot().flows;
  const validActiveFlowId = snapshotFlows.some((f) => f.id === activeFlowId) ? activeFlowId : fallback;
  const deployedFlowIds = readDeploymentFlowIds({ deployedFlowIds: meta.get("deployedFlowIds"), deployFlowId: meta.get("deployFlowId") }, snapshotFlows, validActiveFlowId);
  return {
    // Always stamped current, even on the lenient migration read of an older doc. Migration
    // functions must key off the fromVersion passed to migrateSnapshot, never this field.
    version: VERSION,
    activeFlowId: validActiveFlowId,
    flows: snapshotFlows,
    macros: macroObj,
    settings: {
      autoDeploy: meta.get("autoDeploy") === true,
      deployFlowId: deployedFlowIds[0] ?? validActiveFlowId,
      deployedFlowIds,
    },
  };
}

export function encodeUpdateBase64(update: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: Uint8Array | string, encoding?: string) => { toString: (encoding: string) => string; byteLength: number; buffer: ArrayBuffer; byteOffset: number } } }).Buffer;
  if (maybeBuffer) return maybeBuffer.from(update).toString("base64");
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeUpdateBase64(update: string, maxBytes = DEFAULT_MAX_DOC_UPDATE_BYTES): Uint8Array {
  const estimatedBytes = Math.floor((update.length * 3) / 4);
  if (estimatedBytes > maxBytes) throw new Error("Document update is too large");
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: string, encoding: string) => Uint8Array & { byteLength: number; buffer: ArrayBuffer; byteOffset: number } } }).Buffer;
  if (maybeBuffer) {
    const buf = maybeBuffer.from(update, "base64");
    if (buf.byteLength > maxBytes) throw new Error("Document update is too large");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(update);
  if (binary.length > maxBytes) throw new Error("Document update is too large");
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
