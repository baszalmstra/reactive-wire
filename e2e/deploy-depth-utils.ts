import WebSocket from "ws";

/** A pin value as flattened onto a debugState frame by the server's Deployer.inspect(). */
export interface DebugValue {
  type: string;
  status: string;
  value: unknown;
  msg?: string;
}

/** A node's health and output values as reported by the server runtime. */
export interface DebugNode {
  type: string;
  health: string;
  outputs: Record<string, DebugValue>;
}

/** A service call the runtime wants to make, matching shared/results.ts ServiceCall. */
export interface ServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
  target?: { entity_id?: string };
}

/** A sink's desired call and reconciliation bookkeeping as reported by the server runtime. */
export interface DebugSink {
  desired: ServiceCall | null;
  note?: string;
  status: string;
  inFlight: boolean;
  lastCommand: string | null;
}

/** The server's answer to a `{type:"debugState"}` query — its own view of the deployed graph. */
export interface DebugState {
  type: "debugState";
  timestamp: number;
  deployed: boolean;
  generation: number;
  mode: "live" | "dry-run";
  evaluatedAt: number | null;
  nodes: Record<string, DebugNode>;
  sinks: Record<string, DebugSink>;
  autoDeploy?: boolean;
  error?: string;
}

/** One entity in the server's live feed snapshot. */
export interface FeedEntity {
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: number | null;
  last_updated?: number | null;
}

/** Both halves of a single server round-trip: the live entity feed and the runtime debug snapshot. */
export interface ServerView {
  debug: DebugState;
  entities: Record<string, FeedEntity>;
}

/**
 * Open a WebSocket to the running mock server, request a one-shot debugState snapshot, and also
 * capture the `entities` feed frame the server pushes on connect. This is the cross-layer probe:
 * it reads what the SERVER (not the editor) believes about the deployed graph and the live feed,
 * so a spec can assert the editor → server → runtime path independently of the UI. The connection
 * is loopback with no token, matching the mock server's connection policy.
 */
export function queryServer(port: number, timeoutMs = 5000): Promise<ServerView> {
  return new Promise<ServerView>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { origin: `http://127.0.0.1:${port}` } });
    let entities: Record<string, FeedEntity> = {};
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`Timed out waiting for a debugState response from ws://127.0.0.1:${port}`));
    }, timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify({ type: "debugState" })));
    ws.on("message", (raw) => {
      let msg: Partial<Omit<DebugState, "type">> & { type?: string; entities?: Record<string, FeedEntity> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      // The server pushes `entities` (and `docState`) frames on connect; keep the freshest feed
      // snapshot, then resolve once our own debugState answer arrives.
      if (msg.type === "entities" && msg.entities) {
        entities = msg.entities;
        return;
      }
      if (msg.type !== "debugState") return;
      clearTimeout(timer);
      const debug = msg as DebugState;
      ws.close();
      resolve({ debug, entities });
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Convenience: the debug snapshot alone, for polling generation/deployed without the feed. */
export async function debugState(port: number): Promise<DebugState> {
  return (await queryServer(port)).debug;
}

/** The single node of a given type in a debug snapshot, or undefined if none/ambiguous is fine to fail on. */
export function nodeOfType(debug: DebugState, type: string): DebugNode | undefined {
  return Object.values(debug.nodes).find((n) => n.type === type);
}

/** The single sink entry in a debug snapshot (specs here deploy exactly one sink). */
export function onlySink(debug: DebugState): DebugSink | undefined {
  const sinks = Object.values(debug.sinks);
  return sinks.length === 1 ? sinks[0] : undefined;
}

/** Parse a Home Assistant on/off state string to the bool the engine resolves for a binary_sensor. */
export function stateToBool(state: string): boolean | null {
  const s = state.toLowerCase();
  if (s === "on" || s === "true") return true;
  if (s === "off" || s === "false") return false;
  return null;
}
