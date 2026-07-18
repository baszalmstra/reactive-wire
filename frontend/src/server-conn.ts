import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityMap } from "../../shared/entities.js";
import type { HAConnectionStatus } from "../../shared/ha-status.js";
import type { DocErrorMessage, DocResetAckMessage, DocResetMessage, DocStateMessage, DocUpdateMessage } from "../../shared/collab.js";
import { isRuntimeStateFrame, type RuntimeStateFrame } from "../../shared/protocol.js";

export interface DeployResult {
  ok: boolean;
  unsupported: string[];
  error?: string;
}

export interface DeployGraph {
  nodes: unknown[];
  edges: unknown[];
  /** Macro definitions referenced by macro placements in `nodes`, keyed by id. */
  macros?: Record<string, unknown>;
  /** Annotation comment frames laid over the canvas; they carry no runtime effect. */
  comments?: unknown[];
}

export interface DocPacket {
  update: string;
  nonce: number;
}

export interface DocResetPacket extends DocPacket {
  generation: number;
  error: string;
}

export interface Server {
  connected: boolean;
  /** Server-to-Home-Assistant readiness, separate from this editor's WebSocket. */
  haStatus: HAConnectionStatus;
  entities: EntityMap;
  /** Authoritative deployed-runtime actions and output history pushed by the server. */
  runtimeState: RuntimeStateFrame | null;
  lastResult: DeployResult | null;
  docState: DocPacket | null;
  docUpdate: DocPacket | null;
  docReset: DocResetPacket | null;
  docError: string | null;
  deploy: (graph: DeployGraph) => boolean;
  sendDocUpdate: (update: Uint8Array) => boolean;
  acknowledgeDocReset: (generation: number) => boolean;
}

function runtimeParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  const searchValue = new URLSearchParams(window.location.search).get(name)?.trim();
  if (searchValue) return searchValue;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get(name)?.trim() || undefined;
}

function sameOriginWsUrl(): string | undefined {
  if (typeof window === "undefined" || import.meta.env.VITE_RW_SAME_ORIGIN !== "1") return undefined;
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return undefined;
  const url = new URL(window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.hash = "";
  url.search = "";
  return url.toString();
}

const DEFAULT_URL = runtimeParam("rw_ws") ?? (import.meta.env.VITE_RW_WS as string | undefined) ?? sameOriginWsUrl() ?? "ws://127.0.0.1:7420";
const DEPLOY_TOKEN = runtimeParam("rw_token") ?? (import.meta.env.VITE_RW_DEPLOY_TOKEN as string | undefined)?.trim() ?? "";

function encodeUpdateBase64(update: Uint8Array): string {
  let binary = "";
  for (const byte of update) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function urlWithToken(url: string, token: string): string {
  if (!token) return url;
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("token", token);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Connects to the server: streams the live entity map, and can deploy a graph for the
 * server to run. Reconnects automatically if the server goes away.
 */
export function useServer(url: string = DEFAULT_URL): Server {
  const [connected, setConnected] = useState(false);
  const [haStatus, setHAStatus] = useState<HAConnectionStatus>({ phase: "disconnected", epoch: 0, snapshotVersion: null });
  const [entities, setEntities] = useState<EntityMap>({});
  const [runtimeState, setRuntimeState] = useState<RuntimeStateFrame | null>(null);
  const [lastResult, setLastResult] = useState<DeployResult | null>(null);
  const [docState, setDocState] = useState<DocPacket | null>(null);
  const [docUpdate, setDocUpdate] = useState<DocPacket | null>(null);
  const [docReset, setDocReset] = useState<DocResetPacket | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const nonceRef = useRef(0);
  const entityVersionRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      entityVersionRef.current = null;
      let seenHAStatus = false;
      const ws = new WebSocket(urlWithToken(url, DEPLOY_TOKEN));
      wsRef.current = ws;
      ws.onopen = () => {
        // Servers send deltas only after this explicit opt-in. Older servers safely ignore the
        // unknown frame and continue their legacy full-snapshot stream.
        ws.send(JSON.stringify({ type: "clientCapabilities", entityFeed: "delta-v1" }));
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "haStatus" && msg.status && typeof msg.status === "object"
            && (msg.status.phase === "disconnected" || msg.status.phase === "syncing" || msg.status.phase === "ready")
            && Number.isSafeInteger(msg.status.epoch)) {
            seenHAStatus = true;
            setHAStatus(msg.status as HAConnectionStatus);
          } else if (msg.type === "entities" && msg.entities && typeof msg.entities === "object") {
            if (Number.isSafeInteger(msg.version) && msg.version >= 0) {
              const current = entityVersionRef.current;
              if (current === null || msg.version >= current) {
                entityVersionRef.current = msg.version;
                setEntities(msg.entities as EntityMap);
              }
            } else if (msg.version === undefined) {
              // Legacy servers have neither versions nor explicit HA readiness. Accept each full
              // snapshot, but show conservative syncing status rather than claiming safe actuation.
              entityVersionRef.current = null;
              setEntities(msg.entities as EntityMap);
              if (!seenHAStatus) setHAStatus({ phase: "syncing", epoch: 0, snapshotVersion: null });
            }
          } else if (msg.type === "entityDelta" && Number.isSafeInteger(msg.version) && msg.version >= 0
            && msg.changed && typeof msg.changed === "object" && Array.isArray(msg.removed)) {
            const current = entityVersionRef.current;
            if (current !== null && msg.version <= current) return;
            if (current === null || msg.version !== current + 1) {
              // A missing frame would leave the editor with a silently incomplete world view.
              // Closing uses the existing reconnect path, whose first frame is a full snapshot.
              ws.close(1008, "entity version gap");
              return;
            }
            entityVersionRef.current = msg.version;
            setEntities((previous) => {
              const next = { ...previous };
              for (const entityId of msg.removed as unknown[]) if (typeof entityId === "string") delete next[entityId];
              for (const [entityId, state] of Object.entries(msg.changed as EntityMap)) next[entityId] = state;
              return next;
            });
          } else if (isRuntimeStateFrame(msg)) setRuntimeState(msg);
          else if (msg.type === "deployResult") setLastResult(msg as DeployResult);
          else if (msg.type === "docState" && typeof msg.update === "string") setDocState({ update: (msg as DocStateMessage).update, nonce: ++nonceRef.current });
          else if (msg.type === "docUpdate" && typeof msg.update === "string") setDocUpdate({ update: (msg as DocUpdateMessage).update, nonce: ++nonceRef.current });
          else if (msg.type === "docReset" && typeof msg.update === "string" && Number.isSafeInteger(msg.generation) && typeof msg.error === "string") {
            const reset = msg as DocResetMessage;
            setDocReset({ update: reset.update, generation: reset.generation, error: reset.error, nonce: ++nonceRef.current });
            setDocError(reset.error);
          } else if (msg.type === "docError" && typeof msg.error === "string") setDocError((msg as DocErrorMessage).error);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        setRuntimeState(null);
        setHAStatus((previous) => ({ phase: "disconnected", epoch: previous.epoch, snapshotVersion: null }));
        if (!stopped) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* already closing */
        }
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      try {
        wsRef.current?.close();
      } catch {
        /* already closing */
      }
    };
  }, [url]);

  const deploy = useCallback((graph: DeployGraph): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    setLastResult(null);
    ws.send(JSON.stringify({ type: "deploy", token: DEPLOY_TOKEN || undefined, graph }));
    return true;
  }, []);

  const sendDocUpdate = useCallback((update: Uint8Array): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    setDocError(null);
    const frame: DocUpdateMessage = { type: "docUpdate", token: DEPLOY_TOKEN || undefined, update: encodeUpdateBase64(update) };
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  const acknowledgeDocReset = useCallback((generation: number): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const frame: DocResetAckMessage = { type: "docResetAck", token: DEPLOY_TOKEN || undefined, generation };
    ws.send(JSON.stringify(frame));
    return true;
  }, []);

  return { connected, haStatus, entities, runtimeState, lastResult, docState, docUpdate, docReset, docError, deploy, sendDocUpdate, acknowledgeDocReset };
}
