import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MockHA } from "../src/ha/mock.js";
import { startFeed } from "../src/server/feed.js";

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function nextFrame(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(String(raw)) as Record<string, unknown>;
        if (frame.type !== type) return;
        ws.off("message", onMessage);
        resolve(frame);
      } catch (error) {
        reject(error);
      }
    };
    ws.on("message", onMessage);
  });
}

async function connect(url: string, supportsDeltas = true): Promise<{ ws: WebSocket; initial: Record<string, unknown> }> {
  const ws = new WebSocket(url, { headers: { origin: "http://localhost:5173" } });
  const initial = nextFrame(ws, "entities");
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  if (supportsDeltas) {
    ws.send(JSON.stringify({ type: "clientCapabilities", entityFeed: "delta-v1" }));
    // WebSocket messages are processed in order. A debugState response is a real same-socket
    // round trip proving the preceding capability frame reached the server before a test mutates HA.
    const synchronized = nextFrame(ws, "debugState");
    ws.send(JSON.stringify({ type: "debugState" }));
    await synchronized;
  }
  return { ws, initial: await initial };
}

describe("versioned entity feed", () => {
  it("sends one full snapshot then compact ordered deltas", async () => {
    const port = await freePort();
    const ha = new MockHA();
    ha.setState("light.a", "off");
    const stop = startFeed(ha, { port, host: "127.0.0.1" });
    const { ws, initial } = await connect(`ws://127.0.0.1:${port}`);
    try {
      expect(initial).toMatchObject({
        type: "entities",
        version: 1,
        entities: { "light.a": { state: "off", attributes: {} } },
      });

      const changed = nextFrame(ws, "entityDelta");
      ha.setState("light.a", "on", { brightness: 7 });
      expect(await changed).toEqual({
        type: "entityDelta",
        version: 2,
        changed: { "light.a": { state: "on", attributes: { brightness: 7 } } },
        removed: [],
      });

      const removed = nextFrame(ws, "entityDelta");
      ha.remove("light.a");
      expect(await removed).toEqual({ type: "entityDelta", version: 3, changed: {}, removed: ["light.a"] });
    } finally {
      ws.close();
      stop();
    }
  });

  it("keeps legacy clients current with full snapshots until they negotiate deltas", async () => {
    const port = await freePort();
    const ha = new MockHA();
    ha.setState("light.a", "off");
    const stop = startFeed(ha, { port, host: "127.0.0.1" });
    const { ws } = await connect(`ws://127.0.0.1:${port}`, false);
    try {
      const next = nextFrame(ws, "entities");
      ha.setState("light.a", "on", { brightness: 9 });
      expect(await next).toEqual({
        type: "entities",
        version: 2,
        entities: { "light.a": { state: "on", attributes: { brightness: 9 } } },
      });
    } finally {
      ws.close();
      stop();
    }
  });

  it("streams Home Assistant readiness separately from entity frames", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const stop = startFeed(ha, { port, host: "127.0.0.1" });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers: { origin: "http://localhost:5173" } });
    try {
      const frames: Record<string, unknown>[] = [];
      ws.on("message", (raw) => frames.push(JSON.parse(String(raw)) as Record<string, unknown>));
      await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(frames).toContainEqual({ type: "haStatus", status: { phase: "ready", epoch: 1, snapshotVersion: 0 } });

      const disconnected = nextFrame(ws, "haStatus");
      ha.disconnect();
      expect(await disconnected).toEqual({ type: "haStatus", status: { phase: "disconnected", epoch: 1, snapshotVersion: null } });
    } finally {
      ws.close();
      stop();
    }
  });

  it("gives a newly connected client the latest full version", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const stop = startFeed(ha, { port, host: "127.0.0.1" });
    ha.setState("sensor.a", "1");
    ha.setState("sensor.a", "2");
    const { ws, initial } = await connect(`ws://127.0.0.1:${port}`);
    try {
      expect(initial).toMatchObject({ version: 2, entities: { "sensor.a": { state: "2" } } });
    } finally {
      ws.close();
      stop();
    }
  });
});
