import { useCallback, useEffect, useRef, useState } from "react";
import type { EntityMap } from "../../shared/entities.js";

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

export interface Server {
  connected: boolean;
  entities: EntityMap;
  lastResult: DeployResult | null;
  deploy: (graph: DeployGraph) => boolean;
}

const DEFAULT_URL = (import.meta.env.VITE_RW_WS as string | undefined) ?? "ws://localhost:7420";
const DEPLOY_TOKEN = (import.meta.env.VITE_RW_DEPLOY_TOKEN as string | undefined)?.trim() || "";

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

  return { connected, entities, lastResult, deploy };
}
