import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as Y from "yjs";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  DEFAULT_MAX_DOC_UPDATE_BYTES,
  EDITOR_DOCUMENT_VERSION,
  decodeUpdateBase64,
  emptyEditorDocumentSnapshot,
  encodeUpdateBase64,
  readEditorDocumentVersion,
  snapshotFromEditorDoc,
  applyEditorSnapshot,
  type EditorDocumentSnapshot,
} from "../../shared/collab.js";
import {
  SNAPSHOT_MIGRATIONS,
  migrateSnapshot,
  readMigratableSnapshot,
  type SnapshotMigrationRegistry,
} from "../../shared/collab-migrations.js";
import { log } from "./log.js";

export interface EditorDocumentStoreOptions {
  dataDir?: string;
  fileName?: string;
  maxUpdateBytes?: number;
  maxStateBytes?: number;
  /** Short durability window used to combine a burst of edits into one compact write. */
  persistDelayMs?: number;
  /** The migration chain to upgrade an older persisted document; overridable for tests. */
  migrations?: SnapshotMigrationRegistry;
  /** Test seam for persistence failures/counting. */
  writeState?: (filePath: string, bytes: Uint8Array) => Promise<void>;
}

export interface AppliedDocumentUpdate {
  update: Uint8Array;
  /** The already-validated projection at this update, avoiding a second full projection in feed. */
  snapshot: EditorDocumentSnapshot;
}

interface PendingUpdate extends AppliedDocumentUpdate {
  resolve: (value: AppliedDocumentUpdate) => void;
  reject: (reason: unknown) => void;
}

async function atomicWrite(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, filePath);
}

export class EditorDocumentStore {
  doc: Y.Doc;
  readonly filePath: string;
  readonly maxUpdateBytes: number;
  readonly maxStateBytes: number;
  private readonly migrations: SnapshotMigrationRegistry;
  private readonly persistDelayMs: number;
  private readonly writeState: (filePath: string, bytes: Uint8Array) => Promise<void>;
  private shadow!: Y.Doc;
  private durableState: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private estimatedStateBytes = 0;
  private pending: PendingUpdate[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private closed = false;

  constructor(options: EditorDocumentStoreOptions = {}) {
    this.doc = new Y.Doc();
    this.maxUpdateBytes = options.maxUpdateBytes ?? DEFAULT_MAX_DOC_UPDATE_BYTES;
    this.maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_DOC_STATE_BYTES;
    this.filePath = join(options.dataDir ?? ".rw-data", options.fileName ?? "editor-doc.ydoc");
    this.migrations = options.migrations ?? SNAPSHOT_MIGRATIONS;
    this.persistDelayMs = options.persistDelayMs ?? 20;
    this.writeState = options.writeState ?? atomicWrite;
    this.loadOrSeed();
    this.shadow = this.cloneDocument(this.doc);
    this.durableState = Y.encodeStateAsUpdate(this.doc);
    this.estimatedStateBytes = this.durableState.byteLength;
  }

  snapshot(): EditorDocumentSnapshot {
    return snapshotFromEditorDoc(this.doc);
  }

  /** State sent to newly connected clients is always the last state known durable on disk. */
  encodeState(): Uint8Array {
    return this.durableState.slice();
  }

  encodeStateBase64(): string {
    return encodeUpdateBase64(this.encodeState());
  }

  applyBase64Update(update: string): Promise<AppliedDocumentUpdate> {
    return this.applyUpdate(decodeUpdateBase64(update, this.maxUpdateBytes));
  }

  /**
   * Validate synchronously against a retained shadow document, then resolve only after the batch
   * containing this update is durable. Feed therefore cannot broadcast or auto-deploy an edit that
   * failed to persist.
   */
  applyUpdate(update: Uint8Array): Promise<AppliedDocumentUpdate> {
    if (this.closed) throw new Error("Collaborative document store is closed");
    if (update.byteLength > this.maxUpdateBytes) throw new Error("Document update is too large");
    let snapshot: EditorDocumentSnapshot;
    try {
      Y.applyUpdate(this.shadow, update, this);
      snapshot = snapshotFromEditorDoc(this.shadow);
      const estimate = this.estimatedStateBytes + update.byteLength + 64;
      if (estimate > this.maxStateBytes) {
        const exact = Y.encodeStateAsUpdate(this.shadow).byteLength;
        if (exact > this.maxStateBytes) throw new Error("Collaborative document state is too large");
        this.estimatedStateBytes = exact;
      } else {
        this.estimatedStateBytes = estimate;
      }
    } catch (err) {
      // Yjs updates are not reversible. Rebuild only on rejection; accepted edits keep the shadow
      // synchronized incrementally rather than recreating it from a full encoding each time.
      this.shadow.destroy();
      this.shadow = this.cloneDocument(this.doc);
      throw err;
    }
    Y.applyUpdate(this.doc, update, this);
    const applied = { update, snapshot };
    const promise = new Promise<AppliedDocumentUpdate>((resolve, reject) => {
      this.pending.push({ ...applied, resolve, reject });
    });
    this.scheduleFlush();
    return promise;
  }

  private scheduleFlush(): void {
    if (this.persistTimer || this.flushPromise) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.flush().catch((err) => {
        log("error", "doc-store", "failed to persist collaborative document", { error: err instanceof Error ? err.message : String(err) });
      });
    }, this.persistDelayMs);
  }

  /** Flush all edits accepted before or during this call. */
  async flush(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.flushPromise) {
      await this.flushPromise;
      if (this.pending.length) await this.flush();
      return;
    }
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    const bytes = Y.encodeStateAsUpdate(this.doc);
    if (bytes.byteLength > this.maxStateBytes) {
      const err = new Error("Collaborative document state is too large");
      for (const item of batch) item.reject(err);
      throw err;
    }
    this.flushPromise = this.writeState(this.filePath, bytes)
      .then(() => {
        this.durableState = bytes;
        this.estimatedStateBytes = bytes.byteLength;
        for (const item of batch) item.resolve({ update: item.update, snapshot: item.snapshot });
      })
      .catch((err) => {
        // None of the candidate mutations are authoritative until their compact state is durable.
        // Updates accepted while this write was in flight were based on the same failed candidate,
        // so reject those dependants too and force clients to resend from the durable docState.
        const dependent = this.pending.splice(0);
        this.restoreDurableState();
        for (const item of [...batch, ...dependent]) item.reject(err);
        throw err;
      })
      .finally(() => {
        this.flushPromise = null;
        if (this.pending.length) this.scheduleFlush();
      });
    await this.flushPromise;
    if (this.pending.length) await this.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.flush();
    this.shadow.destroy();
    this.doc.destroy();
  }

  private restoreDurableState(): void {
    this.doc.destroy();
    this.shadow.destroy();
    const restored = new Y.Doc();
    Y.applyUpdate(restored, this.durableState, this);
    this.doc = restored;
    this.shadow = this.cloneDocument(restored);
    this.estimatedStateBytes = this.durableState.byteLength;
  }

  /** Synchronous writes are limited to startup seeding/migration, before the event loop starts. */
  private persistSync(): void {
    const bytes = Y.encodeStateAsUpdate(this.doc);
    if (bytes.byteLength > this.maxStateBytes) throw new Error("Collaborative document state is too large");
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, this.filePath);
  }

  private cloneDocument(source: Y.Doc): Y.Doc {
    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(source), this);
    return clone;
  }

  private loadOrSeed(): void {
    if (existsSync(this.filePath)) {
      const bytes = readFileSync(this.filePath);
      if (bytes.byteLength > 0) {
        if (bytes.byteLength > this.maxStateBytes) throw new Error("Persisted collaborative document state is too large");
        Y.applyUpdate(this.doc, new Uint8Array(bytes), this);
        const version = readEditorDocumentVersion(this.doc);
        if (version === EDITOR_DOCUMENT_VERSION) {
          snapshotFromEditorDoc(this.doc);
          return;
        }
        if (version === undefined) {
          if (this.doc.getMap("flows").size === 0) {
            snapshotFromEditorDoc(this.doc);
            return;
          }
          this.migrateFrom(0);
          return;
        }
        if (typeof version !== "number" || version > EDITOR_DOCUMENT_VERSION) {
          throw new Error(
            `Cannot load editor document version ${String(version)}; this build supports up to version ${EDITOR_DOCUMENT_VERSION}`,
          );
        }
        this.migrateFrom(version);
        return;
      }
    }
    applyEditorSnapshot(this.doc, emptyEditorDocumentSnapshot(), this);
    this.persistSync();
  }

  private migrateFrom(fromVersion: number): void {
    const { snapshot } = readMigratableSnapshot(this.doc);
    const migrated = migrateSnapshot(snapshot, fromVersion, EDITOR_DOCUMENT_VERSION, this.migrations);
    this.backupExistingFile(fromVersion);
    const fresh = new Y.Doc();
    applyEditorSnapshot(fresh, migrated, this);
    this.doc = fresh;
    this.persistSync();
    log("info", "doc-store", "migrated editor document", { from: fromVersion, to: EDITOR_DOCUMENT_VERSION });
  }

  private backupExistingFile(fromVersion: number): void {
    let backup = `${this.filePath}.v${fromVersion}.bak`;
    if (existsSync(backup)) backup = `${this.filePath}.v${fromVersion}.${Date.now()}.bak`;
    copyFileSync(this.filePath, backup);
    log("info", "doc-store", "backed up editor document before migration", { backup });
  }
}
