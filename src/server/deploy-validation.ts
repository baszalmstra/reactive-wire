import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { RuntimeMacroDef, RuntimeMacroMap } from "../../shared/macros.js";
import type { RuntimeNode, RuntimePin, ValueType } from "../../shared/runtime-types.js";
import { isSafeIdentifier } from "../../shared/record.js";
import { expandMacros } from "../../shared/engine/expand.js";
import { validateExpandedGraph, validateReachableMacros } from "../../shared/engine/validate-graph.js";

export interface DeployRequest {
  nodes: RuntimeNode[];
  edges: ViewEdge[];
  /** Macro definitions referenced by macro placements in `nodes`, keyed by id. */
  macros?: RuntimeMacroMap;
}

export type DeployValidation =
  | { ok: true; graph: DeployRequest }
  | { ok: false; error: string };

type RawRecord = Record<string, unknown>;

const VALUE_TYPES = new Set<ValueType>(["bool", "num", "str", "color", "duration", "datetime", "any"]);
const MAX_NODES = 1_000;
const MAX_EDGES = 4_000;
const MAX_MACROS = 100;
const MAX_PINS = 64;
const MAX_RECORD_KEYS = 200;
const SAFE_KEY = /^(?!(__proto__|prototype|constructor)$).{1,200}$/;

function isRecord(v: unknown): v is RawRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown, fallback = "", max = 240): string {
  const s = typeof v === "string" ? v : fallback;
  return s.slice(0, max);
}

function asIdentifier(v: unknown, label: string, fallback = "", max = 240): string {
  const id = asString(v, fallback, max).trim();
  if (!id) throw new Error(`${label} must be a non-empty string`);
  if (!isSafeIdentifier(id)) throw new Error(`${label} uses a reserved identifier`);
  return id;
}

function safeJson(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (depth >= 6) return null;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => safeJson(x, depth + 1));
  if (!isRecord(v)) return null;
  const out: RawRecord = {};
  let count = 0;
  for (const [k, val] of Object.entries(v)) {
    if (!SAFE_KEY.test(k)) continue;
    if (count++ >= MAX_RECORD_KEYS) break;
    out[k] = safeJson(val, depth + 1);
  }
  return out;
}

function safeRecord(v: unknown): Record<string, unknown> {
  return isRecord(v) ? (safeJson(v) as Record<string, unknown>) : {};
}

function sanitizePins(raw: unknown, label: string): RuntimePin[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  if (raw.length > MAX_PINS) throw new Error(`${label} has too many pins`);
  return raw.map((p, i) => {
    if (!isRecord(p)) throw new Error(`${label}[${i}] must be an object`);
    const id = asIdentifier(p.id, `${label}[${i}].id`);
    const rawType = asString(p.type, "any");
    const type = VALUE_TYPES.has(rawType as ValueType) ? (rawType as ValueType) : "any";
    const pin: RuntimePin = { id, label: asString(p.label, id), type };
    if (typeof p.unit === "string") pin.unit = p.unit.slice(0, 40);
    if (typeof p.variadic === "boolean") pin.variadic = p.variadic;
    if (typeof p.ghost === "boolean") pin.ghost = p.ghost;
    if (typeof p.missing === "string") pin.missing = p.missing.slice(0, 240);
    if (typeof p.editable === "boolean") pin.editable = p.editable;
    return pin;
  });
}

function sanitizeNode(raw: unknown, index: number): RuntimeNode {
  if (!isRecord(raw)) throw new Error(`nodes[${index}] must be an object`);
  const id = asIdentifier(raw.id, `nodes[${index}].id`);
  const type = asIdentifier(raw.type, `nodes[${index}].type`);
  const node: RuntimeNode = {
    id,
    type,
    inputs: sanitizePins(raw.inputs, `nodes[${index}].inputs`),
    outputs: sanitizePins(raw.outputs, `nodes[${index}].outputs`),
  };
  if (typeof raw.stateful === "boolean") node.stateful = raw.stateful;
  if (raw.config !== undefined) node.config = safeRecord(raw.config);
  if (raw.values !== undefined) node.values = safeRecord(raw.values);
  if (Array.isArray(raw.typeGroup)) {
    node.typeGroup = raw.typeGroup
      .slice(0, MAX_PINS)
      .map((x, i) => asIdentifier(x, `nodes[${index}].typeGroup[${i}]`));
  }
  return node;
}

function sanitizeEdges(raw: unknown, nodeIds: Set<string>, label = "edges"): ViewEdge[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  if (raw.length > MAX_EDGES) throw new Error(`${label} has too many entries`);
  return raw.map((e, i) => {
    if (!isRecord(e) || !isRecord(e.from) || !isRecord(e.to)) throw new Error(`${label}[${i}] must have from/to objects`);
    const fromNode = asIdentifier(e.from.node, `${label}[${i}].from.node`);
    const fromPin = asIdentifier(e.from.pin, `${label}[${i}].from.pin`);
    const toNode = asIdentifier(e.to.node, `${label}[${i}].to.node`);
    const toPin = asIdentifier(e.to.pin, `${label}[${i}].to.pin`);
    if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) throw new Error(`${label}[${i}] references an unknown node`);
    return {
      id: asIdentifier(e.id, `${label}[${i}].id`, `${fromNode}:${fromPin}->${toNode}:${toPin}`),
      from: { node: fromNode, pin: fromPin },
      to: { node: toNode, pin: toPin },
    };
  });
}

function sanitizeGraph(raw: RawRecord, label = "graph"): { nodes: RuntimeNode[]; edges: ViewEdge[] } {
  if (!Array.isArray(raw.nodes)) throw new Error(`${label}.nodes must be an array`);
  if (raw.nodes.length > MAX_NODES) throw new Error(`${label}.nodes has too many entries`);
  const nodes = raw.nodes.map((n, i) => sanitizeNode(n, i));
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`${label}.nodes contains duplicate id ${JSON.stringify(n.id)}`);
    ids.add(n.id);
  }
  const edges = sanitizeEdges(raw.edges, ids, `${label}.edges`);
  return { nodes, edges };
}

function sanitizeMacro(key: string, raw: unknown): RuntimeMacroDef {
  if (!isRecord(raw)) throw new Error(`macros.${key} must be an object`);
  const id = asIdentifier(raw.id, `macros.${key}.id`, key);
  const { nodes, edges } = sanitizeGraph(raw, `macros.${key}`);
  return {
    id,
    name: asString(raw.name, id),
    inputs: sanitizePins(raw.inputs, `macros.${key}.inputs`),
    outputs: sanitizePins(raw.outputs, `macros.${key}.outputs`),
    nodes,
    edges,
    stateful: typeof raw.stateful === "boolean" ? raw.stateful : nodes.some((n) => n.stateful),
  };
}

export function sanitizeDeployRequest(raw: unknown): DeployValidation {
  try {
    if (!isRecord(raw)) return { ok: false, error: "Deploy graph must be an object" };
    const { nodes, edges } = sanitizeGraph(raw);
    let macros: RuntimeMacroMap | undefined;
    if (raw.macros !== undefined) {
      if (!isRecord(raw.macros)) throw new Error("graph.macros must be an object");
      const entries = Object.entries(raw.macros);
      if (entries.length > MAX_MACROS) throw new Error("graph.macros has too many entries");
      macros = {};
      for (const [key, value] of entries) {
        asIdentifier(key, `macros.${key} key`);
        if (!SAFE_KEY.test(key)) throw new Error(`macros.${key} uses an invalid key`);
        const macro = sanitizeMacro(key, value);
        macros[macro.id] = macro;
      }
    }
    const graph: DeployRequest = { nodes, edges, ...(macros ? { macros } : {}) };
    const macroValidation = validateReachableMacros(nodes, macros ?? {});
    if (!macroValidation.ok) throw new Error(macroValidation.error.message);
    // Validate the fully inlined resource footprint and semantics before the graph reaches the
    // always-on runtime. Expansion is bounded, then the canonical flat graph must be a typed DAG.
    const flat = expandMacros(nodes, edges, macros ?? {}, undefined, true);
    const semanticValidation = validateExpandedGraph(flat.nodes, flat.edges);
    if (!semanticValidation.ok) throw new Error(semanticValidation.error.message);
    return { ok: true, graph };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
