import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  DEFAULT_MAX_DOC_UPDATE_BYTES,
  decodeUpdateBase64,
  encodeUpdateBase64,
  type DocErrorMessage,
  type DocStateMessage,
  type DocUpdateMessage,
  type EditorDocumentSnapshot,
} from "../../shared/collab.js";
import { type EntityFeed } from "../ha/client.js";
import {
  requestToken,
  tokenMatches,
  validateConnection,
  type ConnectionPolicyOptions,
} from "./connection-policy.js";
import { sanitizeDeployRequest, type DeployRequest } from "./deploy-validation.js";
import type { DeployerSnapshot } from "./runtime.js";

export { sanitizeDeployRequest, type DeployRequest } from "./deploy-validation.js";
export { validateConnection } from "./connection-policy.js";

export interface FeedOptions extends ConnectionPolicyOptions {
  /** TCP port for the editor feed. */
  port: number;
  /** Optional directory of built editor assets to serve over HTTP on the same port. */
  staticDir?: string;
}

export interface EditorDocSyncStore {
  maxUpdateBytes?: number;
  maxStateBytes?: number;
  encodeState: () => Uint8Array;
  applyUpdate: (update: Uint8Array) => Uint8Array | void;
  snapshot?: () => EditorDocumentSnapshot;
}

/** The read-only runtime snapshot answered to a debugState query, plus the server's auto-deploy setting. */
export interface DebugStateSnapshot extends DeployerSnapshot {
  autoDeploy?: boolean;
}

export interface FeedHandlers {
  /** Called when an editor deploys a graph; returns a result to send back. */
  onDeploy?: (graph: DeployRequest) => { ok: boolean; unsupported: string[]; error?: string };
  /** Optional collaborative editor document store. When present, docState/docUpdate frames are enabled. */
  documentStore?: EditorDocSyncStore;
  /** Called after a collaborative document update is accepted. Return a deploy result to broadcast. */
  onDocumentChange?: (snapshot: EditorDocumentSnapshot) => { ok: boolean; unsupported?: string[]; error?: string } | void;
  /** Returns a read-only snapshot of runtime state, answering a debugState query. When absent, introspection is disabled. */
  inspect?: () => DebugStateSnapshot;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deployResultFrame(result: { ok: boolean; unsupported?: string[]; error?: string }): string {
  return JSON.stringify({ type: "deployResult", unsupported: [], ...result });
}

function sendDeployResult(ws: WebSocket, result: { ok: boolean; unsupported?: string[]; error?: string }): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(deployResultFrame(result));
}

function broadcastDeployResult(wss: WebSocketServer, result: { ok: boolean; unsupported?: string[]; error?: string }): void {
  const frame = deployResultFrame(result);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(frame);
}

function sendDocError(ws: WebSocket, error: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame: DocErrorMessage = { type: "docError", error };
  ws.send(JSON.stringify(frame));
}

function normalizeOptions(portOrOptions: number | FeedOptions): FeedOptions {
  if (typeof portOrOptions === "number") return { port: portOrOptions, host: "127.0.0.1" };
  return { ...portOrOptions, host: portOrOptions.host ?? "127.0.0.1" };
}

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function relativeStaticPath(req: IncomingMessage): string {
  const url = new URL(req.url ?? "/", "http://reactive-wire.local");
  const pathname = decodeURIComponent(url.pathname);
  const assetIndex = pathname.lastIndexOf("/assets/");
  if (assetIndex >= 0) return pathname.slice(assetIndex + 1);
  if (pathname.endsWith("/") || !extname(pathname)) return "index.html";
  return pathname.replace(/^\/+/, "");
}

function staticFile(staticRoot: string, req: IncomingMessage): string {
  const root = resolve(staticRoot);
  const target = resolve(root, relativeStaticPath(req));
  if (target !== root && !target.startsWith(root + sep)) return resolve(root, "index.html");
  if (!existsSync(target)) return resolve(root, "index.html");
  const stat = statSync(target);
  if (stat.isDirectory()) return resolve(target, "index.html");
  return target;
}

function serveStatic(staticRoot: string, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  try {
    const file = staticFile(staticRoot, req);
    const stat = statSync(file);
    const headers = {
      "content-length": stat.size,
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    };
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

/**
 * Streams entity state to editor clients over WebSocket and accepts deploy/document messages.
 * Policy modules own validation and connection decisions; this module is the transport adapter.
 */
export function startFeed(ha: EntityFeed, portOrOptions: number | FeedOptions, handlers: FeedHandlers = {}): () => void {
  const options = normalizeOptions(portOrOptions);
  const maxDocUpdateBytes = handlers.documentStore?.maxUpdateBytes ?? DEFAULT_MAX_DOC_UPDATE_BYTES;
  const maxDocStateBytes = handlers.documentStore?.maxStateBytes ?? DEFAULT_MAX_DOC_STATE_BYTES;
  const maxPayload = Math.max(8_000_000, Math.ceil(Math.max(maxDocUpdateBytes, maxDocStateBytes) * 1.5) + 2_048);
  const verifyClient = (info: { req: IncomingMessage }, done: (ok: boolean, code?: number, message?: string) => void) => {
    const rejected = validateConnection(info.req, options);
    if (rejected) done(false, rejected.status, rejected.message);
    else done(true);
  };
  let httpServer: HttpServer | null = null;
  const wss = options.staticDir
    ? (() => {
        httpServer = createServer((req, res) => serveStatic(options.staticDir!, req, res));
        const server = new WebSocketServer({ server: httpServer, maxPayload, verifyClient });
        httpServer.listen(options.port, options.host);
        return server;
      })()
    : new WebSocketServer({ port: options.port, host: options.host, maxPayload, verifyClient });

  wss.on("connection", (ws, req) => {
    const connectionTokenOk = tokenMatches(requestToken(req), options.deployToken);
    ws.send(JSON.stringify({ type: "entities", entities: ha.entitiesSnapshot() }));
    if (handlers.documentStore) {
      try {
        const frame: DocStateMessage = { type: "docState", update: encodeUpdateBase64(handlers.documentStore.encodeState()) };
        ws.send(JSON.stringify(frame));
      } catch (err) {
        sendDocError(ws, err instanceof Error ? err.message : String(err));
      }
    }
    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        sendDeployResult(ws, { ok: false, error: "Malformed JSON message" });
        return;
      }
      if (!isRecord(msg)) return;
      const messageToken = typeof msg.token === "string" ? msg.token : null;
      const tokenOk = connectionTokenOk || tokenMatches(messageToken, options.deployToken);

      if (msg.type === "docUpdate") {
        if (!handlers.documentStore) {
          sendDocError(ws, "Collaborative document sync is not enabled on this server");
          return;
        }
        if (!tokenOk) {
          sendDocError(ws, "Invalid deploy token");
          return;
        }
        if (typeof msg.update !== "string") {
          sendDocError(ws, "Document update must be a base64 string");
          return;
        }
        try {
          const update = decodeUpdateBase64(msg.update, maxDocUpdateBytes);
          const applied = handlers.documentStore.applyUpdate(update) ?? update;
          const frame: DocUpdateMessage = { type: "docUpdate", update: encodeUpdateBase64(applied) };
          const encodedFrame = JSON.stringify(frame);
          for (const client of wss.clients) {
            if (client === ws || client.readyState !== WebSocket.OPEN) continue;
            if (client.bufferedAmount > maxPayload) {
              client.close(1009, "client is too far behind");
              continue;
            }
            client.send(encodedFrame);
          }
          if (handlers.onDocumentChange && handlers.documentStore.snapshot) {
            const result = handlers.onDocumentChange(handlers.documentStore.snapshot());
            if (result) broadcastDeployResult(wss, result);
          }
        } catch (err) {
          sendDocError(ws, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (msg.type === "debugState") {
        // A read-only introspection query. The connection policy already restricts who can reach
        // the feed at all, so no deploy token is required; the answer goes only to the asker.
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > maxPayload) {
          ws.close(1009, "client is too far behind");
          return;
        }
        try {
          const snapshot = handlers.inspect
            ? handlers.inspect()
            : { deployed: false, error: "Introspection is not enabled on this server" };
          ws.send(JSON.stringify({ type: "debugState", timestamp: Date.now(), ...snapshot }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "debugState", deployed: false, error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }

      if (msg.type !== "deploy") return;
      if (!handlers.onDeploy) {
        sendDeployResult(ws, { ok: false, error: "Deploy is not enabled on this server" });
        return;
      }
      if (!tokenOk) {
        sendDeployResult(ws, { ok: false, error: "Invalid deploy token" });
        return;
      }
      const validated = sanitizeDeployRequest(msg.graph);
      if (!validated.ok) {
        sendDeployResult(ws, { ok: false, error: validated.error });
        return;
      }
      try {
        broadcastDeployResult(wss, handlers.onDeploy(validated.graph));
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        broadcastDeployResult(wss, { ok: false, error });
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
        if (client.readyState !== WebSocket.OPEN) continue;
        if (client.bufferedAmount > maxPayload) {
          client.close(1009, "client is too far behind");
          continue;
        }
        client.send(msg);
      }
    }, 150);
  });

  return () => {
    unsub();
    if (pending) clearTimeout(pending);
    wss.close();
    httpServer?.close();
  };
}
