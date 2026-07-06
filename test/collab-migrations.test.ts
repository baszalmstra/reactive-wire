import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyEditorSnapshot,
  emptyEditorDocumentSnapshot,
  type CollabNode,
  type EditorDocumentSnapshot,
} from "../shared/collab.js";
import { migrateSnapshot, type SnapshotMigrationRegistry } from "../shared/collab-migrations.js";
import { EditorDocumentStore } from "../src/server/doc-store.js";

function withFlowNodes(snapshot: EditorDocumentSnapshot, nodes: CollabNode[]): EditorDocumentSnapshot {
  return { ...snapshot, flows: [{ ...snapshot.flows[0]!, nodes }] };
}

function markerNode(id: string): CollabNode {
  return { id, type: "rw", position: { x: 0, y: 0 } };
}

/** Append a marker node so a test migration's effect is observable in the rebuilt document. */
function appendMarker(id: string): (snapshot: EditorDocumentSnapshot) => EditorDocumentSnapshot {
  return (snapshot) => withFlowNodes(snapshot, [...snapshot.flows[0]!.nodes, markerNode(id)]);
}

/** Persist a document at a fabricated schema version so the load path exercises migration. */
function writeDocAtVersion(filePath: string, version: number, nodes: CollabNode[] = []): void {
  const doc = new Y.Doc();
  applyEditorSnapshot(doc, withFlowNodes(emptyEditorDocumentSnapshot(), nodes));
  doc.getMap("meta").set("version", version);
  writeFileSync(filePath, Y.encodeStateAsUpdate(doc));
}

/** Persist a document with content but no version stamp, mimicking a pre-versioning build. */
function writeUnversionedDoc(filePath: string, nodes: CollabNode[]): void {
  const doc = new Y.Doc();
  applyEditorSnapshot(doc, withFlowNodes(emptyEditorDocumentSnapshot(), nodes));
  doc.getMap("meta").delete("version");
  writeFileSync(filePath, Y.encodeStateAsUpdate(doc));
}

function nodeIds(store: EditorDocumentStore): string[] {
  return store.snapshot().flows[0]!.nodes.map((n) => n.id);
}

describe("migrateSnapshot", () => {
  it("applies migrations stepwise up to the target version", () => {
    const registry: SnapshotMigrationRegistry = {
      [-1]: appendMarker("s-1"),
      0: appendMarker("s0"),
    };
    const start = withFlowNodes(emptyEditorDocumentSnapshot(), [markerNode("orig")]);

    const out = migrateSnapshot(start, -1, 1, registry);

    expect(out.flows[0]!.nodes.map((n) => n.id)).toEqual(["orig", "s-1", "s0"]);
  });

  it("throws when a step in the chain is missing", () => {
    expect(() => migrateSnapshot(emptyEditorDocumentSnapshot(), 0, 1, {})).toThrow(/No editor document migration/);
  });

  it("returns the snapshot untouched when already at the target version", () => {
    const snapshot = emptyEditorDocumentSnapshot();
    expect(migrateSnapshot(snapshot, 1, 1, {})).toBe(snapshot);
  });
});

describe("EditorDocumentStore migration on load", () => {
  it("migrates an older persisted document stepwise, backing up the original", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-mig-"));
    try {
      writeDocAtVersion(join(dir, "editor-doc.ydoc"), -1, [markerNode("orig")]);
      const migrations: SnapshotMigrationRegistry = {
        [-1]: appendMarker("s-1"),
        0: appendMarker("s0"),
      };

      const store = new EditorDocumentStore({ dataDir: dir, migrations });

      expect(store.snapshot().version).toBe(1);
      expect(nodeIds(store)).toEqual(["orig", "s-1", "s0"]);
      // The pre-migration file is preserved for rollback and never silently overwritten.
      expect(existsSync(join(dir, "editor-doc.ydoc.v-1.bak"))).toBe(true);

      // A restart now sees a current-version file, so it does not migrate or back up again.
      const reloaded = new EditorDocumentStore({ dataDir: dir, migrations });
      expect(nodeIds(reloaded)).toEqual(["orig", "s-1", "s0"]);
      const backups = readdirSync(dir).filter((f) => f.endsWith(".bak"));
      expect(backups).toEqual(["editor-doc.ydoc.v-1.bak"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves a current-version document untouched, never invoking migrations or writing a backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-mig-cur-"));
    try {
      writeDocAtVersion(join(dir, "editor-doc.ydoc"), 1, [markerNode("keep")]);
      const migrations: SnapshotMigrationRegistry = {
        0: () => { throw new Error("migration must not run for a current-version document"); },
      };

      const store = new EditorDocumentStore({ dataDir: dir, migrations });

      expect(nodeIds(store)).toEqual(["keep"]);
      expect(readdirSync(dir).some((f) => f.endsWith(".bak"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates a legacy unversioned document with content instead of crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-mig-legacy-"));
    try {
      writeUnversionedDoc(join(dir, "editor-doc.ydoc"), [markerNode("legacy")]);

      const store = new EditorDocumentStore({ dataDir: dir });

      expect(store.snapshot().version).toBe(1);
      expect(nodeIds(store)).toEqual(["legacy"]);
      expect(existsSync(join(dir, "editor-doc.ydoc.v0.bak"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to load a document from a newer version than it supports", () => {
    const dir = mkdtempSync(join(tmpdir(), "rw-mig-new-"));
    try {
      writeDocAtVersion(join(dir, "editor-doc.ydoc"), 999, [markerNode("future")]);

      expect(() => new EditorDocumentStore({ dataDir: dir })).toThrow(/version 999/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
