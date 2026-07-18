import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyEditorSnapshot,
  applyEditorSnapshotDiff,
  emptyEditorDocumentSnapshot,
  sanitizeEditorDocumentSnapshot,
  snapshotFromEditorDoc,
  UnsupportedEditorDocumentVersionError,
  type CollabNode,
  type EditorDocumentSnapshot,
} from "../shared/collab.js";
import { EditorDocumentStore } from "../src/server/doc-store.js";

function node(id: string, x: number): CollabNode {
  return {
    id,
    type: "rw",
    position: { x, y: 0 },
    dragHandle: ".rw-drag",
    data: {
      def: {
        id,
        type: "const-number",
        title: "Number",
        subtitle: "",
        icon: "const",
        x,
        y: 0,
        inputs: [],
        outputs: [{ id: "out", label: "out", type: "num", editable: true }],
      },
    },
  };
}

function withNodes(...nodes: CollabNode[]): EditorDocumentSnapshot {
  const base = emptyEditorDocumentSnapshot();
  return { ...base, flows: [{ ...base.flows[0]!, nodes, edges: [] }] };
}

describe("collaborative editor document model", () => {
  it("drops prototype-sensitive flow, node, edge, and macro identifiers", () => {
    const snapshot = sanitizeEditorDocumentSnapshot({
      version: 1,
      activeFlowId: "__proto__",
      flows: [
        { id: "__proto__", name: "Bad", nodes: [], edges: [] },
        {
          id: "safe",
          name: "Safe",
          nodes: [node("constructor", 0), node("ok", 1)],
          edges: [{ id: "prototype", source: "ok", target: "ok" }],
        },
      ],
      macros: {
        safe: { id: "__proto__", name: "Bad", inputs: [], outputs: [], nodes: [], edges: [], stateful: false },
        badNode: {
          id: "badNode", name: "Bad node", inputs: [], outputs: [], stateful: false,
          nodes: [{ id: "constructor", type: "const-number", title: "Number", subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [] }], edges: [],
        },
        badPin: { id: "badPin", name: "Bad pin", inputs: [{ id: "prototype", label: "in", type: "num" }], outputs: [], nodes: [], edges: [], stateful: false },
        badEdge: {
          id: "badEdge", name: "Bad edge", inputs: [], outputs: [], nodes: [], stateful: false,
          edges: [{ id: "edge", from: { node: "a", pin: "__proto__" }, to: { node: "b", pin: "in" } }],
        },
      },
      settings: { autoDeploy: false, deployedFlowIds: ["__proto__", "safe"] },
    });

    expect(snapshot.flows.map((flow) => flow.id)).toEqual(["safe"]);
    expect(snapshot.activeFlowId).toBe("safe");
    expect(snapshot.flows[0]!.nodes.map((item) => item.id)).toEqual(["ok"]);
    expect(snapshot.flows[0]!.edges).toEqual([]);
    expect(snapshot.macros).toEqual({});
    expect(snapshot.settings.deployedFlowIds).toEqual(["safe"]);
  });

  it("drops dangling edges when sanitizing collaborative snapshots", () => {
    const snapshot = sanitizeEditorDocumentSnapshot({
      version: 1,
      flows: [{ id: "flow", name: "Flow", nodes: [node("a", 0)], edges: [{ id: "dangling", source: "a", target: "missing" }] }],
      macros: {},
    });

    expect(snapshot.flows[0]!.edges).toEqual([]);
  });

  it("merges concurrent edits to different nested fields on the same node", () => {
    const server = new Y.Doc();
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    const initial = withNodes(node("shared", 0));
    applyEditorSnapshotDiff(server, emptyEditorDocumentSnapshot(), initial, "init");
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(server));

    const baseNode = node("shared", 0);
    const def = (baseNode.data as { def: Record<string, unknown> }).def;
    const changedValue = withNodes({
      ...baseNode,
      data: { def: { ...def, values: { out: 7 } } },
    });
    const changedConfig = withNodes({
      ...baseNode,
      data: { def: { ...def, config: { label: "Renamed" } } },
    });
    applyEditorSnapshotDiff(clientA, initial, changedValue, "client-a");
    applyEditorSnapshotDiff(clientB, initial, changedConfig, "client-b");

    Y.applyUpdate(server, Y.encodeStateAsUpdate(clientA, Y.encodeStateVector(server)));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(clientB, Y.encodeStateVector(server)));
    const result = snapshotFromEditorDoc(server).flows[0]!.nodes[0]!;

    const resultDef = (result.data as { def: { values?: { out?: number }; config?: { label?: string } } }).def;
    expect(resultDef.values?.out).toBe(7);
    expect(resultDef.config?.label).toBe("Renamed");
  });

  it("converges when two clients add different nodes concurrently", () => {
    const server = new Y.Doc();
    const clientA = new Y.Doc();
    const clientB = new Y.Doc();
    const initial = emptyEditorDocumentSnapshot();
    applyEditorSnapshotDiff(server, initial, initial, "init");
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(server));

    applyEditorSnapshotDiff(clientA, initial, withNodes(node("a", 10)), "client-a");
    applyEditorSnapshotDiff(clientB, initial, withNodes(node("b", 20)), "client-b");

    const updateA = Y.encodeStateAsUpdate(clientA, Y.encodeStateVector(server));
    const updateB = Y.encodeStateAsUpdate(clientB, Y.encodeStateVector(server));
    Y.applyUpdate(server, updateB);
    Y.applyUpdate(server, updateA);
    Y.applyUpdate(clientA, Y.encodeStateAsUpdate(server, Y.encodeStateVector(clientA)));
    Y.applyUpdate(clientB, Y.encodeStateAsUpdate(server, Y.encodeStateVector(clientB)));

    const a = snapshotFromEditorDoc(clientA);
    const b = snapshotFromEditorDoc(clientB);
    expect(a).toEqual(b);
    expect(a.flows[0]!.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("syncs server-side auto-deploy settings through the collaborative document", () => {
    const doc = new Y.Doc();
    const base = emptyEditorDocumentSnapshot();
    const enabled: EditorDocumentSnapshot = { ...base, settings: { autoDeploy: true, deployFlowId: base.flows[0]!.id, deployedFlowIds: [base.flows[0]!.id] } };

    applyEditorSnapshotDiff(doc, base, enabled, "client");

    expect(snapshotFromEditorDoc(doc).settings).toEqual({ autoDeploy: true, deployFlowId: base.flows[0]!.id, deployedFlowIds: [base.flows[0]!.id] });
  });

  it("does not emit updates for an unchanged snapshot diff", () => {
    const doc = new Y.Doc();
    const snapshot = withNodes(node("same", 0));
    applyEditorSnapshotDiff(doc, emptyEditorDocumentSnapshot(), snapshot, "init");
    let updates = 0;
    doc.on("update", () => { updates += 1; });

    applyEditorSnapshotDiff(doc, snapshot, snapshot, "no-op");

    expect(updates).toBe(0);
  });

  it("refuses unsupported persisted document versions instead of resetting them", () => {
    const doc = new Y.Doc();
    doc.getMap("meta").set("version", 999);
    doc.getMap("flows").set("flow", new Y.Map());

    expect(() => snapshotFromEditorDoc(doc)).toThrow(UnsupportedEditorDocumentVersionError);
  });

  it("rejects unsupported-version updates without corrupting persisted state", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-collab-version-"));
    try {
      const store = new EditorDocumentStore({ dataDir: dir });
      const futureDoc = new Y.Doc();
      (futureDoc as unknown as { clientID: number }).clientID = store.doc.clientID + 1;
      Y.applyUpdate(futureDoc, Y.encodeStateAsUpdate(store.doc));
      futureDoc.getMap("meta").set("version", 999);
      const update = Y.encodeStateAsUpdate(futureDoc, Y.encodeStateVector(store.doc));

      expect(() => store.applyUpdate(update)).toThrow(/Unsupported editor document version: 999/);
      expect(store.snapshot().version).toBe(1);
      expect(new EditorDocumentStore({ dataDir: dir }).snapshot().version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists editor document state across store restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-collab-"));
    try {
      const store = new EditorDocumentStore({ dataDir: dir });
      const before = snapshotFromEditorDoc(store.doc);
      const client = new Y.Doc();
      Y.applyUpdate(client, store.encodeState());
      applyEditorSnapshotDiff(client, before, withNodes(node("persisted", 42)), "client");
      await store.applyUpdate(Y.encodeStateAsUpdate(client, Y.encodeStateVector(store.doc)));
      await store.close();

      const reloaded = new EditorDocumentStore({ dataDir: dir });
      expect(reloaded.snapshot().flows[0]!.nodes.map((n) => n.id)).toContain("persisted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
