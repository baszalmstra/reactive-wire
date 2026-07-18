import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyEditorSnapshotDiff, snapshotFromEditorDoc, type CollabNode } from "../shared/collab.js";
import { EditorDocumentStore } from "../src/server/doc-store.js";

function node(id: string): CollabNode {
  return { id, type: "rw", position: { x: 0, y: 0 }, data: { def: { id, type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [{ id: "out", label: "out", type: "num" }] } } };
}

function addNodeUpdate(store: EditorDocumentStore, id: string): Uint8Array {
  const client = new Y.Doc();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(store.doc));
  const before = snapshotFromEditorDoc(client);
  applyEditorSnapshotDiff(client, before, {
    ...before,
    flows: [{ ...before.flows[0]!, nodes: [...before.flows[0]!.nodes, node(id)], edges: [] }],
  }, "client");
  return Y.encodeStateAsUpdate(client, Y.encodeStateVector(store.doc));
}

describe("batched collaborative document persistence", () => {
  it("combines rapid accepted updates into one durable compact write", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-doc-batch-"));
    let writes = 0;
    try {
      const store = new EditorDocumentStore({
        dataDir: dir,
        persistDelayMs: 50,
        writeState: async (path, bytes) => {
          writes += 1;
          await writeFile(path, bytes);
        },
      });
      const first = store.applyUpdate(addNodeUpdate(store, "one"));
      const second = store.applyUpdate(addNodeUpdate(store, "two"));

      await Promise.all([first, second]);
      expect(writes).toBe(1);
      await store.close();

      const restored = new EditorDocumentStore({ dataDir: dir });
      expect(restored.snapshot().flows[0]!.nodes.map((item) => item.id)).toEqual(["one", "two"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failed candidate so a later successful edit cannot resurrect it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-doc-rollback-"));
    let writes = 0;
    try {
      const store = new EditorDocumentStore({
        dataDir: dir,
        persistDelayMs: 60_000,
        writeState: async (path, bytes) => {
          writes += 1;
          if (writes === 1) throw new Error("disk full");
          await writeFile(path, bytes);
        },
      });
      const peer = new Y.Doc();
      Y.applyUpdate(peer, store.encodeState());

      const failed = store.applyUpdate(addNodeUpdate(store, "failed"));
      await expect(store.flush()).rejects.toThrow("disk full");
      await expect(failed).rejects.toThrow("disk full");
      expect(store.snapshot().flows[0]!.nodes).toEqual([]);

      const succeeded = store.applyUpdate(addNodeUpdate(store, "second"));
      await store.flush();
      const applied = await succeeded;
      Y.applyUpdate(peer, applied.update);
      expect(snapshotFromEditorDoc(peer).flows[0]!.nodes.map((item) => item.id)).toEqual(["second"]);
      expect(store.snapshot().flows[0]!.nodes.map((item) => item.id)).toEqual(["second"]);

      const restored = new EditorDocumentStore({ dataDir: dir });
      expect(restored.snapshot().flows[0]!.nodes.map((item) => item.id)).toEqual(["second"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flushes a pending update during close and rejects persistence failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-doc-close-"));
    try {
      const store = new EditorDocumentStore({ dataDir: dir, persistDelayMs: 60_000 });
      const accepted = store.applyUpdate(addNodeUpdate(store, "closed"));
      await store.close();
      await expect(accepted).resolves.toMatchObject({ snapshot: { version: 1 } });
      expect(new EditorDocumentStore({ dataDir: dir }).snapshot().flows[0]!.nodes[0]?.id).toBe("closed");

      const failing = new EditorDocumentStore({
        dataDir: dir,
        persistDelayMs: 60_000,
        writeState: async () => { throw new Error("disk full"); },
      });
      const rejected = failing.applyUpdate(addNodeUpdate(failing, "not-durable"));
      await expect(failing.flush()).rejects.toThrow("disk full");
      await expect(rejected).rejects.toThrow("disk full");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
