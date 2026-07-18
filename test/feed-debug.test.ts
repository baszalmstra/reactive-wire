import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MockHA } from "../src/ha/mock.js";
import { Deployer } from "../src/server/runtime.js";
import { startFeed } from "../src/server/feed.js";
import type { NodeData } from "../shared/node-types.js";
import type { ViewEdge } from "../shared/engine/evaluate.js";

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      server.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
}

function nextMessage(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: WebSocket.RawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch (err) {
        reject(err);
        return;
      }
      if (msg.type === type) {
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

async function open(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url, { headers: { origin: "http://localhost:5173" } });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

async function openWithFrame(url: string, type: string): Promise<{ ws: WebSocket; frame: Record<string, unknown> }> {
  const ws = new WebSocket(url, { headers: { origin: "http://localhost:5173" } });
  const framePromise = nextMessage(ws, type);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, frame: await framePromise };
}

/** A boolean entity driving a reconciling input_boolean sink, so both a source output and a sink appear. */
function graph(): { nodes: NodeData[]; edges: ViewEdge[] } {
  const nodes: NodeData[] = [
    { id: "src", type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0, config: { entity_id: "binary_sensor.x" }, inputs: [], outputs: [{ id: "state", label: "", type: "bool" }] },
    { id: "snk", type: "sink-input", title: "", subtitle: "", icon: "const", x: 0, y: 0, config: { entity_id: "input_boolean.flag" }, inputs: [{ id: "value", label: "", type: "bool" }], outputs: [] },
  ];
  const edges: ViewEdge[] = [{ id: "e", from: { node: "src", pin: "state" }, to: { node: "snk", pin: "value" } }];
  return { nodes, edges };
}

describe("feed debugState introspection", () => {
  it("answers a debugState query with node outputs, health, and sink state", async () => {
    const port = await freePort();
    const ha = new MockHA();
    ha.setState("binary_sensor.x", "on");
    ha.setState("input_boolean.flag", "off");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = graph();
    deployer.deploy(nodes, edges, false);

    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {
      inspect: () => ({ ...deployer.inspect(), autoDeploy: false }),
    });
    const ws = await open(`ws://127.0.0.1:${port}`);
    try {
      const reply = nextMessage(ws, "debugState");
      ws.send(JSON.stringify({ type: "debugState" }));
      const state = await reply;

      expect(state.deployed).toBe(true);
      expect(state.mode).toBe("dry-run");
      expect(state.autoDeploy).toBe(false);
      expect(typeof state.timestamp).toBe("number");
      expect(typeof state.evaluatedAt).toBe("number");
      expect(state.generation).toBeGreaterThanOrEqual(1);

      const nodesOut = state.nodes as Record<string, { health: string; outputs: Record<string, { value: unknown; status: string }> }>;
      expect(nodesOut.src?.health).toBe("ok");
      expect(nodesOut.src?.outputs.state?.value).toBe(true);
      expect(nodesOut.src?.outputs.state?.status).toBe("ok");

      const sinks = state.sinks as Record<string, { desired: { domain: string; service: string; target?: { entity_id: string } } | null; lastCall: { domain: string; service: string; target?: { entity_id: string } } | null; lastTriggeredAt: number | null; status: string; inFlight: boolean }>;
      // Desired on, actual off -> the sink wants to turn the helper on.
      expect(sinks.snk?.desired?.domain).toBe("input_boolean");
      expect(sinks.snk?.desired?.service).toBe("turn_on");
      expect(sinks.snk?.desired?.target?.entity_id).toBe("input_boolean.flag");
      expect(sinks.snk?.lastCall?.domain).toBe("input_boolean");
      expect(sinks.snk?.lastCall?.service).toBe("turn_on");
      expect(typeof sinks.snk?.lastTriggeredAt).toBe("number");
      expect(sinks.snk?.inFlight).toBe(false);
    } finally {
      ws.close();
      stop();
      deployer.stop();
    }
  });

  it("pushes existing and changing server runtime history to newly opened editors", async () => {
    const port = await freePort();
    const ha = new MockHA();
    ha.setState("binary_sensor.x", "on");
    ha.setState("input_boolean.flag", "off");
    const deployer = new Deployer(ha, 100_000);
    const { nodes, edges } = graph();
    deployer.deploy(nodes, edges, true);

    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {
      inspect: () => ({ ...deployer.inspect(), autoDeploy: false }),
      subscribeRuntime: (listener) => deployer.subscribe(listener),
    });
    const opened = await openWithFrame(`ws://127.0.0.1:${port}`, "runtimeState");
    const ws = opened.ws;
    try {
      const initial = opened.frame;
      expect(initial.mode).toBe("live");
      const initialSinks = initial.sinks as Record<string, { lastTriggeredAt: number | null }>;
      expect(typeof initialSinks.snk?.lastTriggeredAt).toBe("number");
      const initialHistory = initial.history as Record<string, unknown[]>;
      expect(initialHistory["src:state"]).toHaveLength(1);

      const changed = nextMessage(ws, "runtimeState");
      ha.setState("binary_sensor.x", "off");
      const update = await changed;
      const history = update.history as Record<string, Array<{ value: { value: unknown } }>>;
      expect(history["src:state"]?.map((sample) => sample.value.value)).toEqual([true, false]);
    } finally {
      ws.close();
      stop();
      deployer.stop();
    }
  });

  it("keeps the editor connected when best-effort runtime telemetry exceeds the frame budget", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const oversizedHistory = {
      "large:out": [{ value: { type: "any", status: "ok", value: "x".repeat(13_000_000) }, t: 1 }],
    };
    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {
      inspect: () => ({
        deployed: true,
        generation: 1,
        mode: "live",
        graphFingerprint: "large-graph",
        sinks: {},
        history: oversizedHistory,
      }) as never,
    });
    const opened = await openWithFrame(`ws://127.0.0.1:${port}`, "haStatus");
    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(opened.ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      opened.ws.close();
      stop();
    }
  });

  it("catches an unserializable snapshot instead of crashing the message handler", async () => {
    const port = await freePort();
    const ha = new MockHA();
    // A circular value would throw inside JSON.stringify in the ws message callback; the send guard
    // must turn that into an error frame and keep the connection alive for the next query.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {
      inspect: () => ({ deployed: true, generation: 1, mode: "dry-run", graphFingerprint: "test-graph", evaluatedAt: null, nodes: {}, sinks: {}, history: {}, extra: circular }) as never,
    });
    const ws = await open(`ws://127.0.0.1:${port}`);
    try {
      const first = nextMessage(ws, "debugState");
      ws.send(JSON.stringify({ type: "debugState" }));
      const state = await first;
      expect(state.deployed).toBe(false);
      expect(String(state.error)).toContain("circular");

      // The server survived: a second query still gets an answer.
      const second = nextMessage(ws, "debugState");
      ws.send(JSON.stringify({ type: "debugState" }));
      expect((await second).type).toBe("debugState");
    } finally {
      ws.close();
      stop();
    }
  });

  it("reports introspection disabled when no inspect handler is wired", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {});
    const ws = await open(`ws://127.0.0.1:${port}`);
    try {
      const reply = nextMessage(ws, "debugState");
      ws.send(JSON.stringify({ type: "debugState" }));
      const state = await reply;
      expect(state.deployed).toBe(false);
      expect(String(state.error)).toContain("not enabled");
    } finally {
      ws.close();
      stop();
    }
  });
});
