import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useServer } from "./server-conn.js";

/**
 * A stand-in for the browser WebSocket that lets a test drive the connection lifecycle: open it,
 * push server frames, and close it. `instances` records every socket the hook constructs so a
 * reconnect can be observed as a second instance.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  // ── test drivers ──────────────────────────────────────────────────────────
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  emit(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(): void {
    this.close();
  }
  lastSentFrame(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1]!);
  }
}

function latest(): FakeWebSocket {
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
}

describe("useServer", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects and dispatches an entities frame into state", () => {
    const { result } = renderHook(() => useServer("ws://test.local"));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.connected).toBe(false);

    act(() => latest().emitOpen());
    expect(result.current.connected).toBe(true);

    const entities = { "light.bedroom": { state: "on", attributes: {} } };
    act(() => latest().emit({ type: "entities", entities }));
    expect(result.current.entities).toEqual(entities);
  });

  it("sends a deploy frame only while open and resolves the later deployResult", () => {
    const { result } = renderHook(() => useServer("ws://test.local"));

    // Before the socket opens, deploy is refused and nothing is sent.
    let sent = false;
    act(() => {
      sent = result.current.deploy({ nodes: [], edges: [] });
    });
    expect(sent).toBe(false);
    expect(latest().sent).toHaveLength(0);

    act(() => latest().emitOpen());
    const graph = { nodes: [{ id: "n1" }], edges: [] };
    act(() => {
      sent = result.current.deploy(graph);
    });
    expect(sent).toBe(true);
    const frame = latest().lastSentFrame();
    expect(frame.type).toBe("deploy");
    expect(frame.graph).toEqual(graph);

    // The server's answer arrives as its own frame and lands on lastResult.
    act(() => latest().emit({ type: "deployResult", ok: true, unsupported: ["sink-tts"] }));
    expect(result.current.lastResult).toEqual({ type: "deployResult", ok: true, unsupported: ["sink-tts"] });
  });

  it("round-trips document updates in both directions", () => {
    const { result } = renderHook(() => useServer("ws://test.local"));
    act(() => latest().emitOpen());

    // Outbound: raw bytes are base64-encoded into a docUpdate frame.
    act(() => {
      result.current.sendDocUpdate(new Uint8Array([1, 2, 3]));
    });
    const frame = latest().lastSentFrame();
    expect(frame.type).toBe("docUpdate");
    expect(frame.update).toBe(btoa(String.fromCharCode(1, 2, 3)));

    // Inbound docState and docUpdate frames surface as packets with an incrementing nonce.
    act(() => latest().emit({ type: "docState", update: "c3RhdGU=" }));
    expect(result.current.docState?.update).toBe("c3RhdGU=");
    const stateNonce = result.current.docState!.nonce;

    act(() => latest().emit({ type: "docUpdate", update: "dXBkYXRl" }));
    expect(result.current.docUpdate?.update).toBe("dXBkYXRl");
    expect(result.current.docUpdate!.nonce).toBeGreaterThan(stateNonce);
  });

  it("reconnects with a backoff after the socket closes", () => {
    renderHook(() => useServer("ws://test.local"));
    act(() => latest().emitOpen());
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => latest().serverClose());
    // No immediate reconnect; the retry is scheduled behind the backoff.
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("stops reconnecting and ignores frames after dispose", () => {
    const { result, unmount } = renderHook(() => useServer("ws://test.local"));
    act(() => latest().emitOpen());
    const socket = latest();
    act(() => socket.emit({ type: "entities", entities: { "sun.sun": { state: "above_horizon", attributes: {} } } }));
    const seen = result.current.entities;

    unmount();

    // A close after dispose must not schedule a new connection.
    act(() => {
      socket.serverClose();
      vi.advanceTimersByTime(5000);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    // A late frame on the disposed socket does not mutate the last observed state.
    act(() => socket.emit({ type: "entities", entities: { "sun.sun": { state: "below_horizon", attributes: {} } } }));
    expect(result.current.entities).toBe(seen);
  });
});
