import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import * as Y from "yjs";
import { encodeUpdateBase64, applyEditorSnapshotDiff, snapshotFromEditorDoc, type CollabNode } from "../shared/collab.js";
import { MockHA } from "../src/ha/mock.js";
import { EditorDocumentStore } from "../src/server/doc-store.js";
import { startFeed } from "../src/server/feed.js";

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

async function openWithDocState(url: string): Promise<{ ws: WebSocket; state: Record<string, unknown> }> {
  const ws = new WebSocket(url, { headers: { origin: "http://localhost:5173" } });
  const statePromise = nextMessage(ws, "docState");
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, state: await statePromise };
}

function node(id: string): CollabNode {
  return { id, type: "rw", position: { x: 1, y: 2 }, data: { def: { id, type: "const-number", title: "Number", subtitle: "", icon: "const", x: 1, y: 2, inputs: [], outputs: [{ id: "out", label: "out", type: "num" }] } } };
}

describe("feed collaborative document sync", () => {
  it("sends persisted doc state, broadcasts doc updates to other clients, and does not deploy", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const dir = mkdtempSync(join(tmpdir(), "rw-feed-collab-"));
    const store = new EditorDocumentStore({ dataDir: dir });
    let deploys = 0;
    const stop = startFeed(ha, { port, host: "127.0.0.1" }, {
      documentStore: store,
      onDeploy: () => {
        deploys += 1;
        return { ok: true, unsupported: [] };
      },
    });

    const { ws: a, state: aState } = await openWithDocState(`ws://127.0.0.1:${port}`);
    const { ws: b, state: bState } = await openWithDocState(`ws://127.0.0.1:${port}`);
    try {
      expect(typeof aState.update).toBe("string");
      expect(typeof bState.update).toBe("string");

      const docA = new Y.Doc();
      Y.applyUpdate(docA, Buffer.from(String(aState.update), "base64"));
      const before = snapshotFromEditorDoc(docA);
      applyEditorSnapshotDiff(docA, before, { ...before, flows: [{ ...before.flows[0]!, nodes: [node("shared")], edges: [] }] }, "client-a");
      const update = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(store.doc));
      const bUpdate = nextMessage(b, "docUpdate");
      a.send(JSON.stringify({ type: "docUpdate", update: encodeUpdateBase64(update) }));

      const frame = await bUpdate;
      const docB = new Y.Doc();
      Y.applyUpdate(docB, Buffer.from(String(bState.update), "base64"));
      Y.applyUpdate(docB, Buffer.from(String(frame.update), "base64"));
      expect(snapshotFromEditorDoc(docB).flows[0]!.nodes.map((n) => n.id)).toContain("shared");
      expect(store.snapshot().flows[0]!.nodes.map((n) => n.id)).toContain("shared");
      expect(deploys).toBe(0);
    } finally {
      a.close();
      b.close();
      stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid document update frames without changing the store", async () => {
    const port = await freePort();
    const ha = new MockHA();
    const dir = mkdtempSync(join(tmpdir(), "rw-feed-collab-invalid-"));
    const store = new EditorDocumentStore({ dataDir: dir });
    const before = store.snapshot();
    const stop = startFeed(ha, { port, host: "127.0.0.1" }, { documentStore: store });
    const ws = await open(`ws://127.0.0.1:${port}`);
    try {
      const error = nextMessage(ws, "docError");
      ws.send(JSON.stringify({ type: "docUpdate", update: 123 }));

      expect((await error).error).toContain("base64 string");
      expect(store.snapshot()).toEqual(before);
    } finally {
      ws.close();
      stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves persisted collaborative state after feed and store restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-feed-collab-restart-"));
    const ha = new MockHA();
    const portA = await freePort();
    let store = new EditorDocumentStore({ dataDir: dir });
    let stop = startFeed(ha, { port: portA, host: "127.0.0.1" }, { documentStore: store });
    const { ws, state } = await openWithDocState(`ws://127.0.0.1:${portA}`);
    try {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Buffer.from(String(state.update), "base64"));
      const before = snapshotFromEditorDoc(doc);
      applyEditorSnapshotDiff(doc, before, { ...before, flows: [{ ...before.flows[0]!, nodes: [node("after-restart")], edges: [] }] }, "client");
      ws.send(JSON.stringify({ type: "docUpdate", update: encodeUpdateBase64(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(store.doc))) }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      ws.close();
      stop();
    }

    const portB = await freePort();
    store = new EditorDocumentStore({ dataDir: dir });
    stop = startFeed(ha, { port: portB, host: "127.0.0.1" }, { documentStore: store });
    const { ws: reconnected, state: restartedState } = await openWithDocState(`ws://127.0.0.1:${portB}`);
    try {
      const restored = new Y.Doc();
      Y.applyUpdate(restored, Buffer.from(String(restartedState.update), "base64"));
      expect(snapshotFromEditorDoc(restored).flows[0]!.nodes.map((n) => n.id)).toContain("after-restart");
    } finally {
      reconnected.close();
      stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
