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
  type DocResetMessage,
  type DocStateMessage,
  type DocUpdateMessage,
  type EditorDocumentSnapshot,
} from "../../shared/collab.js";
import type { AppliedDocumentUpdate } from "./doc-store.js";
import { parseJsonRecord } from "../../shared/json.js";
import {
  frameToken,
  isClientCapabilitiesMessage,
  isDebugStateRequestMessage,
  isDeployClientMessage,
  isDocResetAckMessage,
  isDocUpdateMessage,
  type RuntimeStateFrame,
} from "../../shared/protocol.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
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
  applyUpdate: (update: Uint8Array) => Promise<AppliedDocumentUpdate>;
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
  /** Returns a read-only snapshot of runtime state, answering debug queries and the editor runtime feed. */
  inspect?: () => DebugStateSnapshot;
  /** Subscribes the feed to authoritative runtime changes. */
  subscribeRuntime?: (listener: () => void) => () => void;
}

function runtimeStateFrame(snapshot: DebugStateSnapshot): RuntimeStateFrame {
  const sinks: RuntimeStateFrame["sinks"] = {};
  for (const [nodeId, sink] of Object.entries(snapshot.sinks)) {
    sinks[nodeId] = {
      desired: sink.desired,
      ...(sink.note ? { note: sink.note.slice(0, 512) } : {}),
      status: sink.status,
      lastCall: sink.lastCall,
      lastTriggeredAt: sink.lastTriggeredAt,
    };
  }
  return {
    type: "runtimeState",
    deployed: snapshot.deployed,
    generation: snapshot.generation,
    mode: snapshot.mode,
    graphFingerprint: snapshot.graphFingerprint,
    sinks,
    history: snapshot.history,
  };
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

function sendDocReset(ws: WebSocket, store: EditorDocSyncStore, generation: number, error: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const frame: DocResetMessage = {
    type: "docReset",
    update: encodeUpdateBase64(store.encodeState()),
    generation,
    error,
  };
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
export function startFeed(ha: EntityFeed & HAClient, portOrOptions: number | FeedOptions, handlers: FeedHandlers = {}): () => void {
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

  const deltaEntityClients = new Set<WebSocket>();
  const resetPending = new WeakMap<WebSocket, number>();
  let resetGeneration = 0;
  let feedStopped = false;

  const sendBoundedRuntimeFrame = (ws: WebSocket, frame: string): void => {
    const frameBytes = Buffer.byteLength(frame);
    // Runtime telemetry is best-effort. A graph-wide snapshot that cannot fit must not disconnect
    // the editor into a reconnect loop; keep entity/document sync alive and try a later snapshot.
    if (frameBytes > maxPayload) return;
    if (ws.bufferedAmount + frameBytes > maxPayload) {
      ws.close(1009, "client is too far behind");
      return;
    }
    ws.send(frame);
  };

  wss.on("connection", (ws, req) => {
    const connectionTokenOk = tokenMatches(requestToken(req), options.deployToken);
    const entitySnapshot = ha.entitiesSnapshot();
    ws.send(JSON.stringify({ type: "entities", version: entitySnapshot.version, entities: entitySnapshot.entities }));
    const homeLocation = ha.homeLocation();
    ws.send(JSON.stringify({ type: "homeLocation", location: homeLocation }));
    ws.send(JSON.stringify({ type: "haStatus", status: ha.connectionStatus() }));
    if (handlers.inspect) {
      try {
        sendBoundedRuntimeFrame(ws, JSON.stringify(runtimeStateFrame(handlers.inspect())));
      } catch {
        // Runtime telemetry is best-effort and must not prevent the editor feed from connecting.
      }
    }
    ws.once("close", () => deltaEntityClients.delete(ws));
    if (handlers.documentStore) {
      try {
        const frame: DocStateMessage = { type: "docState", update: encodeUpdateBase64(handlers.documentStore.encodeState()) };
        ws.send(JSON.stringify(frame));
      } catch (err) {
        sendDocError(ws, err instanceof Error ? err.message : String(err));
      }
    }
    ws.on("message", (raw) => {
      const msg = parseJsonRecord(String(raw));
      if (!msg) {
        sendDeployResult(ws, { ok: false, error: "Malformed JSON message" });
        return;
      }
      const tokenOk = connectionTokenOk || tokenMatches(frameToken(msg), options.deployToken);

      if (isClientCapabilitiesMessage(msg)) {
        deltaEntityClients.add(ws);
        return;
      }

      if (msg.type === "docResetAck") {
        if (!isDocResetAckMessage(msg) || !tokenOk) return;
        if (resetPending.get(ws) === msg.generation) resetPending.delete(ws);
        return;
      }

      if (msg.type === "docUpdate") {
        if (!handlers.documentStore) {
          sendDocError(ws, "Collaborative document sync is not enabled on this server");
          return;
        }
        if (!tokenOk) {
          sendDocError(ws, "Invalid deploy token");
          return;
        }
        if (!isDocUpdateMessage(msg)) {
          sendDocError(ws, "Document update must be a base64 string");
          return;
        }
        const pendingReset = resetPending.get(ws);
        if (pendingReset !== undefined) {
          sendDocReset(ws, handlers.documentStore, pendingReset, "Authoritative document reset is pending");
          return;
        }
        try {
          const update = decodeUpdateBase64(msg.update, maxDocUpdateBytes);
          // The store resolves only after its compact batch is durable. Do not broadcast or invoke
          // auto-deploy before that point, and reuse its validated snapshot rather than projecting
          // the complete document again in the transport layer.
          void handlers.documentStore.applyUpdate(update).then((applied) => {
            const frame: DocUpdateMessage = { type: "docUpdate", update: encodeUpdateBase64(applied.update) };
            const encodedFrame = JSON.stringify(frame);
            for (const client of wss.clients) {
              if (client === ws || client.readyState !== WebSocket.OPEN) continue;
              if (client.bufferedAmount > maxPayload) {
                client.close(1009, "client is too far behind");
                continue;
              }
              client.send(encodedFrame);
            }
            if (handlers.onDocumentChange) {
              const result = handlers.onDocumentChange(applied.snapshot);
              if (result) broadcastDeployResult(wss, result);
            }
          }).catch((err) => {
            const error = err instanceof Error ? err.message : String(err);
            let generation = resetPending.get(ws);
            if (generation === undefined) {
              generation = ++resetGeneration;
              resetPending.set(ws, generation);
            }
            // A rejected Yjs update cannot be undone by merging another state vector. Replace the
            // sender's document from this durable state and block its updates until it acknowledges.
            sendDocReset(ws, handlers.documentStore!, generation, error);
          });
        } catch (err) {
          sendDocError(ws, err instanceof Error ? err.message : String(err));
        }
        return;
      }

      if (isDebugStateRequestMessage(msg)) {
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
      if (!isDeployClientMessage(msg)) {
        sendDeployResult(ws, { ok: false, error: "Deploy frame must include a graph" });
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

  let runtimeBroadcastQueued = false;
  const unsubRuntime = handlers.subscribeRuntime?.(() => {
    if (!handlers.inspect || feedStopped || runtimeBroadcastQueued || wss.clients.size === 0) return;
    runtimeBroadcastQueued = true;
    // Coalesce the trigger/evaluation/completion notifications from one transaction and keep
    // telemetry serialization outside the server's final pre-actuation boundary.
    queueMicrotask(() => {
      runtimeBroadcastQueued = false;
      if (feedStopped || wss.clients.size === 0) return;
      let frame: string;
      try {
        frame = JSON.stringify(runtimeStateFrame(handlers.inspect!()));
      } catch {
        return;
      }
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) sendBoundedRuntimeFrame(client, frame);
      }
    });
  }) ?? (() => {});

  const unsub = ha.onEntities((update) => {
    const deltaMessage = update.kind === "delta"
      ? JSON.stringify({ type: "entityDelta", version: update.version, changed: update.changed, removed: update.removed })
      : null;
    const fullFromUpdate = update.kind === "full"
      ? JSON.stringify({ type: "entities", version: update.version, entities: update.entities })
      : null;
    let currentFull: string | null = fullFromUpdate;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > maxPayload) {
        client.close(1009, "client is too far behind");
        continue;
      }
      if (deltaMessage && deltaEntityClients.has(client)) {
        client.send(deltaMessage);
      } else {
        // Unknown clients may be an already-open editor from before the server upgrade. Keep its
        // legacy full-snapshot stream live until it explicitly opts into ordered deltas.
        currentFull ??= (() => {
          const snapshot = ha.entitiesSnapshot();
          return JSON.stringify({ type: "entities", version: snapshot.version, entities: snapshot.entities });
        })();
        client.send(currentFull);
      }
    }
  });

  const unsubLocation = ha.onLocation((location) => {
    // Missing is an authoritative replacement too: editors must clear their old location so
    // preview evaluation remains aligned with the server's unavailable environmental values.
    const msg = JSON.stringify({ type: "homeLocation", location });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  });

  const unsubConnection = ha.onConnection((status) => {
    const msg = JSON.stringify({ type: "haStatus", status });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  });

  return () => {
    feedStopped = true;
    unsubRuntime();
    unsub();
    unsubLocation();
    unsubConnection();
    wss.close();
    httpServer?.close();
  };
}
