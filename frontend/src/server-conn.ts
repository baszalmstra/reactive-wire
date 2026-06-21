import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityMap } from "../../shared/entities.js";
import type { DocErrorMessage, DocStateMessage, DocUpdateMessage } from "../../shared/collab.js";

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

export interface Server {
  connected: boolean;
  entities: EntityMap;
  lastResult: DeployResult | null;
  docState: DocPacket | null;
  docUpdate: DocPacket | null;
  docError: string | null;
  deploy: (graph: DeployGraph) => boolean;
  sendDocUpdate: (update: Uint8Array) => boolean;
}

const DEFAULT_URL = (import.meta.env.VITE_RW_WS as string | undefined) ?? "ws://127.0.0.1:7420";
const DEPLOY_TOKEN = (import.meta.env.VITE_RW_DEPLOY_TOKEN as string | undefined)?.trim() || "";

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
  const [entities, setEntities] = useState<EntityMap>({});
  const [lastResult, setLastResult] = useState<DeployResult | null>(null);
  const [docState, setDocState] = useState<DocPacket | null>(null);
  const [docUpdate, setDocUpdate] = useState<DocPacket | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const nonceRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(urlWithToken(url, DEPLOY_TOKEN));
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "entities") setEntities(msg.entities as EntityMap);
          else if (msg.type === "deployResult") setLastResult(msg as DeployResult);
          else if (msg.type === "docState" && typeof msg.update === "string") setDocState({ update: (msg as DocStateMessage).update, nonce: ++nonceRef.current });
          else if (msg.type === "docUpdate" && typeof msg.update === "string") setDocUpdate({ update: (msg as DocUpdateMessage).update, nonce: ++nonceRef.current });
          else if (msg.type === "docError" && typeof msg.error === "string") setDocError((msg as DocErrorMessage).error);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
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

  return { connected, entities, lastResult, docState, docUpdate, docError, deploy, sendDocUpdate };
}
