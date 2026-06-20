import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { MacroDef, MacroMap } from "../../shared/macros.js";
import type { NodeData, PinDef } from "../../shared/node-types.js";
import type { ValueType } from "../../shared/theme.js";
import { type EntityFeed } from "../ha/client.js";

export interface DeployRequest {
  nodes: NodeData[];
  edges: ViewEdge[];
  /** Macro definitions referenced by macro placements in `nodes`, keyed by id. */
  macros?: MacroMap;
}

export interface FeedOptions {
  /** TCP port for the editor feed. */
  port: number;
  /** Bind address. Defaults to loopback so deploy/control is not exposed by accident. */
  host?: string;
  /** Extra Host header names accepted in addition to loopback hosts. Use only when intentionally exposing the server. */
  allowedHosts?: string[];
  /** Extra browser Origin values accepted in addition to loopback/null local-file origins. */
  allowedOrigins?: string[];
  /** Optional deploy/control token; when set, clients must provide it as a `token` query parameter. */
  deployToken?: string;
}

export interface FeedHandlers {
  /** Called when an editor deploys a graph; returns a result to send back. */
  onDeploy?: (graph: DeployRequest) => { ok: boolean; unsupported: string[]; error?: string };
}

type RawRecord = Record<string, unknown>;

type DeployValidation =
  | { ok: true; graph: DeployRequest }
  | { ok: false; error: string };

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

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

function sanitizePins(raw: unknown, label: string): PinDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  if (raw.length > MAX_PINS) throw new Error(`${label} has too many pins`);
  return raw.map((p, i) => {
    if (!isRecord(p)) throw new Error(`${label}[${i}] must be an object`);
    const id = asString(p.id).trim();
    if (!id) throw new Error(`${label}[${i}].id must be a non-empty string`);
    const rawType = asString(p.type, "any");
    const type = VALUE_TYPES.has(rawType as ValueType) ? (rawType as ValueType) : "any";
    const pin: PinDef = {
      id,
      label: asString(p.label, id),
      type,
    };
    if (typeof p.unit === "string") pin.unit = p.unit.slice(0, 40);
    if (typeof p.variadic === "boolean") pin.variadic = p.variadic;
    if (typeof p.ghost === "boolean") pin.ghost = p.ghost;
    if (typeof p.missing === "string") pin.missing = p.missing.slice(0, 240);
    if (typeof p.editable === "boolean") pin.editable = p.editable;
    return pin;
  });
}

function sanitizeNode(raw: unknown, index: number): NodeData {
  if (!isRecord(raw)) throw new Error(`nodes[${index}] must be an object`);
  const id = asString(raw.id).trim();
  const type = asString(raw.type).trim();
  if (!id) throw new Error(`nodes[${index}].id must be a non-empty string`);
  if (!type) throw new Error(`nodes[${index}].type must be a non-empty string`);
  const node: NodeData = {
    id,
    type,
    title: asString(raw.title, type),
    subtitle: asString(raw.subtitle, ""),
    icon: asString(raw.icon, "const") as NodeData["icon"],
    x: asNumber(raw.x),
    y: asNumber(raw.y),
    inputs: sanitizePins(raw.inputs, `nodes[${index}].inputs`),
    outputs: sanitizePins(raw.outputs, `nodes[${index}].outputs`),
  };
  if (typeof raw.stateful === "boolean") node.stateful = raw.stateful;
  if (raw.config !== undefined) node.config = safeRecord(raw.config);
  if (raw.values !== undefined) node.values = safeRecord(raw.values);
  if (Number.isFinite(Number(raw.w)) && Number(raw.w) > 0) node.w = asNumber(raw.w);
  if (Number.isFinite(Number(raw.bodyExtra)) && Number(raw.bodyExtra) >= 0) node.bodyExtra = asNumber(raw.bodyExtra);
  if (raw.widget === "color" || raw.widget === "sink") node.widget = raw.widget;
  if (Array.isArray(raw.typeGroup)) node.typeGroup = raw.typeGroup.map((x) => asString(x).trim()).filter(Boolean).slice(0, MAX_PINS);
  return node;
}

function sanitizeEdges(raw: unknown, nodeIds: Set<string>, label = "edges"): ViewEdge[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${label} must be an array`);
  if (raw.length > MAX_EDGES) throw new Error(`${label} has too many entries`);
  return raw.map((e, i) => {
    if (!isRecord(e) || !isRecord(e.from) || !isRecord(e.to)) throw new Error(`${label}[${i}] must have from/to objects`);
    const fromNode = asString(e.from.node).trim();
    const fromPin = asString(e.from.pin).trim();
    const toNode = asString(e.to.node).trim();
    const toPin = asString(e.to.pin).trim();
    if (!fromNode || !fromPin || !toNode || !toPin) throw new Error(`${label}[${i}] endpoints must name node and pin`);
    if (!nodeIds.has(fromNode) || !nodeIds.has(toNode)) throw new Error(`${label}[${i}] references an unknown node`);
    return {
      id: asString(e.id, `${fromNode}:${fromPin}->${toNode}:${toPin}`),
      from: { node: fromNode, pin: fromPin },
      to: { node: toNode, pin: toPin },
    };
  });
}

function sanitizeGraph(raw: RawRecord, label = "graph"): { nodes: NodeData[]; edges: ViewEdge[] } {
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

function sanitizeMacro(key: string, raw: unknown): MacroDef {
  if (!isRecord(raw)) throw new Error(`macros.${key} must be an object`);
  const id = asString(raw.id, key).trim();
  if (!id) throw new Error(`macros.${key}.id must be a non-empty string`);
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
    let macros: MacroMap | undefined;
    if (raw.macros !== undefined) {
      if (!isRecord(raw.macros)) throw new Error("graph.macros must be an object");
      const entries = Object.entries(raw.macros);
      if (entries.length > MAX_MACROS) throw new Error("graph.macros has too many entries");
      macros = {};
      for (const [key, value] of entries) {
        if (!SAFE_KEY.test(key)) continue;
        const macro = sanitizeMacro(key, value);
        macros[macro.id] = macro;
      }
    }
    return { ok: true, graph: { nodes, edges, ...(macros ? { macros } : {}) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function header(req: IncomingMessage, name: string): string {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

function hostName(hostHeader: string): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`ws://${hostHeader}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return hostHeader.split(":")[0]?.replace(/^\[|\]$/g, "").toLowerCase() ?? null;
  }
}

function normalizeAllowedHost(host: string): string {
  if (host === "*") return "*";
  try {
    return hostName(host.includes("://") ? new URL(host).host : host) ?? host.toLowerCase();
  } catch {
    return hostName(host) ?? host.toLowerCase();
  }
}

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h === "::1") return true;
  // Only numeric IPv4 loopback addresses are accepted here. A hostname such as
  // `127.attacker.example` may resolve to localhost via DNS rebinding but is not itself a
  // loopback literal, so it must not satisfy the default no-token local deploy policy.
  return isIP(h) === 4 && h.split(".")[0] === "127";
}

function isAllowedHost(req: IncomingMessage, options: FeedOptions): boolean {
  const host = hostName(header(req, "host"));
  const allowed = (options.allowedHosts ?? []).map((h) => normalizeAllowedHost(h));
  return allowed.includes("*") || isLoopbackHost(host) || (host ? allowed.includes(host) : false);
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "").toLowerCase();
}

function isAllowedOrigin(req: IncomingMessage, options: FeedOptions): boolean {
  const origin = header(req, "origin");
  if (!origin) return true;
  const host = hostName(header(req, "host"));
  // Browser connections from a local standalone file use Origin: null. Keep that convenient only
  // for loopback connections; exposed servers should use explicit allowed origins and/or a token.
  if (origin === "null") return isLoopbackHost(host);
  const allowed = (options.allowedOrigins ?? []).map((o) => normalizeOrigin(o));
  if (allowed.includes("*")) return true;
  if (allowed.includes(normalizeOrigin(origin))) return true;
  if (allowed.length > 0) return false;
  try {
    return isLoopbackHost(new URL(origin).hostname.replace(/^\[|\]$/g, ""));
  } catch {
    return false;
  }
}

function requestToken(req: IncomingMessage): string | null {
  try {
    const url = new URL(req.url ?? "/", "ws://reactive-wire.local");
    return url.searchParams.get("token") ?? url.searchParams.get("rw_token");
  } catch {
    return null;
  }
}

function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateConnection(req: IncomingMessage, options: FeedOptions): { status: number; message: string } | null {
  if (!isAllowedHost(req, options)) return { status: 403, message: "WebSocket Host is not allowed" };
  if (!isAllowedOrigin(req, options)) return { status: 403, message: "WebSocket Origin is not allowed" };
  if (!tokenMatches(requestToken(req), options.deployToken)) return { status: 401, message: "Invalid deploy token" };
  return null;
}

function sendDeployResult(ws: WebSocket, result: { ok: boolean; unsupported?: string[]; error?: string }): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "deployResult", unsupported: [], ...result }));
}

function normalizeOptions(portOrOptions: number | FeedOptions): FeedOptions {
  if (typeof portOrOptions === "number") return { port: portOrOptions, host: "127.0.0.1" };
  return { ...portOrOptions, host: portOrOptions.host ?? "127.0.0.1" };
}

/**
 * Streams entity state to editor clients over WebSocket and accepts deploy requests.
 * Each client gets the full snapshot on connect and on change (coalesced).
 */
export function startFeed(ha: EntityFeed, portOrOptions: number | FeedOptions, handlers: FeedHandlers = {}): () => void {
  const options = normalizeOptions(portOrOptions);
  const wss = new WebSocketServer({
    port: options.port,
    host: options.host,
    verifyClient: (info, done) => {
      const rejected = validateConnection(info.req, options);
      if (rejected) done(false, rejected.status, rejected.message);
      else done(true);
    },
  });

  wss.on("connection", (ws, req) => {
    const connectionTokenOk = tokenMatches(requestToken(req), options.deployToken);
    ws.send(JSON.stringify({ type: "entities", entities: ha.entitiesSnapshot() }));
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        sendDeployResult(ws, { ok: false, error: "Malformed JSON message" });
        return;
      }
      if (!isRecord(msg) || msg.type !== "deploy") return;
      if (!handlers.onDeploy) {
        sendDeployResult(ws, { ok: false, error: "Deploy is not enabled on this server" });
        return;
      }
      const messageToken = typeof msg.token === "string" ? msg.token : null;
      if (!connectionTokenOk && !tokenMatches(messageToken, options.deployToken)) {
        sendDeployResult(ws, { ok: false, error: "Invalid deploy token" });
        return;
      }
      const validated = sanitizeDeployRequest(msg.graph);
      if (!validated.ok) {
        sendDeployResult(ws, { ok: false, error: validated.error });
        return;
      }
      try {
        sendDeployResult(ws, handlers.onDeploy(validated.graph));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        sendDeployResult(ws, { ok: false, error });
      }
    });
  });

  let pending: ReturnType<typeof setTimeout> | null = null;
  const unsub = ha.onEntities(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const msg = JSON.stringify({ type: "entities", entities: ha.entitiesSnapshot() });
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      }
    }, 150);
  });

  return () => {
    unsub();
    if (pending) clearTimeout(pending);
    wss.close();
  };
}
