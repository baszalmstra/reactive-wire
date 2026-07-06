import * as Y from "yjs";
import {
  EDITOR_DOCUMENT_VERSION,
  readEditorDocumentSnapshotUnchecked,
  readEditorDocumentVersion,
  type EditorDocumentSnapshot,
} from "./collab.js";

/** Lifts a snapshot from one schema version to the next. Pure: it maps JSON to JSON. */
export type SnapshotMigration = (snapshot: EditorDocumentSnapshot) => EditorDocumentSnapshot;

/** From-version keyed migrations: registry[n] upgrades a version-n snapshot to version n+1. */
export type SnapshotMigrationRegistry = Record<number, SnapshotMigration>;

/**
 * The built-in migration chain, keyed by the version each step upgrades from. The only step is the
 * legacy normalization from version 0: a document written before the schema carried a version reads
 * back as version 0 (see the version-0 fallback in readMigratableSnapshot), and its content already
 * matches version 1, so the step to 1 is a structural re-stamp with no field changes. There is no
 * schema-changing migration yet because EDITOR_DOCUMENT_VERSION is still 1. When the version bumps,
 * add the from-version key that lifts a snapshot one step (key 1 turns a v1 snapshot into v2, and
 * so on).
 */
export const SNAPSHOT_MIGRATIONS: SnapshotMigrationRegistry = {
  0: (snapshot) => snapshot,
};

/**
 * Apply migrations stepwise to bring a snapshot read at `fromVersion` up to `target`. Each step is
 * looked up by the version it upgrades from; a missing step is a hard error rather than a silent
 * skip, so an unmigratable document fails loudly instead of loading half-transformed.
 */
export function migrateSnapshot(
  snapshot: EditorDocumentSnapshot,
  fromVersion: number,
  target: number = EDITOR_DOCUMENT_VERSION,
  registry: SnapshotMigrationRegistry = SNAPSHOT_MIGRATIONS,
): EditorDocumentSnapshot {
  let current = snapshot;
  for (let v = fromVersion; v < target; v += 1) {
    const step = registry[v];
    if (!step) throw new Error(`No editor document migration registered from version ${v}`);
    current = step(current);
  }
  return current;
}

/**
 * Extract a migratable snapshot from a document whose version predates the current one, pairing the
 * document's stored version with its structurally-read snapshot. The version guard is bypassed on
 * purpose — the caller has already decided this document needs upgrading.
 */
export function readMigratableSnapshot(doc: Y.Doc): { version: number; snapshot: EditorDocumentSnapshot } {
  const raw = readEditorDocumentVersion(doc);
  const version = typeof raw === "number" ? raw : 0;
  return { version, snapshot: readEditorDocumentSnapshotUnchecked(doc) };
}
