import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Y from "yjs";
import { DEFAULT_MAX_DOC_STATE_BYTES, DEFAULT_MAX_DOC_UPDATE_BYTES, EDITOR_DOCUMENT_VERSION, decodeUpdateBase64, emptyEditorDocumentSnapshot, encodeUpdateBase64, readEditorDocumentVersion, snapshotFromEditorDoc, applyEditorSnapshot, } from "../../shared/collab.js";
import { SNAPSHOT_MIGRATIONS, migrateSnapshot, readMigratableSnapshot, } from "../../shared/collab-migrations.js";
import { log } from "./log.js";
export class EditorDocumentStore {
    doc;
    filePath;
    maxUpdateBytes;
    maxStateBytes;
    migrations;
    constructor(options = {}) {
        this.doc = new Y.Doc();
        this.maxUpdateBytes = options.maxUpdateBytes ?? DEFAULT_MAX_DOC_UPDATE_BYTES;
        this.maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_DOC_STATE_BYTES;
        this.filePath = join(options.dataDir ?? ".rw-data", options.fileName ?? "editor-doc.ydoc");
        this.migrations = options.migrations ?? SNAPSHOT_MIGRATIONS;
        this.loadOrSeed();
    }
    snapshot() {
        return snapshotFromEditorDoc(this.doc);
    }
    encodeState() {
        const state = Y.encodeStateAsUpdate(this.doc);
        if (state.byteLength > this.maxStateBytes)
            throw new Error("Collaborative document state is too large");
        return state;
    }
    encodeStateBase64() {
        return encodeUpdateBase64(this.encodeState());
    }
    applyBase64Update(update) {
        return this.applyUpdate(decodeUpdateBase64(update, this.maxUpdateBytes));
    }
    applyUpdate(update) {
        if (update.byteLength > this.maxUpdateBytes)
            throw new Error("Document update is too large");
        const nextDoc = new Y.Doc();
        Y.applyUpdate(nextDoc, Y.encodeStateAsUpdate(this.doc), this);
        Y.applyUpdate(nextDoc, update, this);
        snapshotFromEditorDoc(nextDoc);
        const nextState = Y.encodeStateAsUpdate(nextDoc);
        if (nextState.byteLength > this.maxStateBytes)
            throw new Error("Collaborative document state is too large");
        Y.applyUpdate(this.doc, update, this);
        this.persist();
        return update;
    }
    persist() {
        const bytes = this.encodeState();
        mkdirSync(dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, bytes);
        renameSync(tmp, this.filePath);
    }
    loadOrSeed() {
        if (existsSync(this.filePath)) {
            const bytes = readFileSync(this.filePath);
            if (bytes.byteLength > 0) {
                if (bytes.byteLength > this.maxStateBytes)
                    throw new Error("Persisted collaborative document state is too large");
                Y.applyUpdate(this.doc, new Uint8Array(bytes), this);
                const version = readEditorDocumentVersion(this.doc);
                if (version === EDITOR_DOCUMENT_VERSION) {
                    snapshotFromEditorDoc(this.doc);
                    return;
                }
                if (version === undefined) {
                    // A blank doc has no flows and is seeded in place; a legacy document written before the
                    // schema carried a version has content but no version, so it migrates from version 0.
                    if (this.doc.getMap("flows").size === 0) {
                        snapshotFromEditorDoc(this.doc);
                        return;
                    }
                    this.migrateFrom(0);
                    return;
                }
                if (typeof version !== "number" || version > EDITOR_DOCUMENT_VERSION) {
                    throw new Error(`Cannot load editor document version ${String(version)}; this build supports up to version ${EDITOR_DOCUMENT_VERSION}`);
                }
                this.migrateFrom(version);
                return;
            }
        }
        applyEditorSnapshot(this.doc, emptyEditorDocumentSnapshot(), this);
        this.persist();
    }
    /**
     * Upgrade an older persisted document. The old snapshot is read leniently, migrated stepwise to
     * the current version, backed up on disk, then a fresh Y.Doc is rebuilt from the result and
     * persisted. Migration rebuilds the document from its projected snapshot, so the old CRDT edit
     * history is dropped — acceptable for this single-server store, where clients resync from scratch.
     */
    migrateFrom(fromVersion) {
        const { snapshot } = readMigratableSnapshot(this.doc);
        const migrated = migrateSnapshot(snapshot, fromVersion, EDITOR_DOCUMENT_VERSION, this.migrations);
        this.backupExistingFile(fromVersion);
        const fresh = new Y.Doc();
        applyEditorSnapshot(fresh, migrated, this);
        this.doc = fresh;
        this.persist();
        log("info", "doc-store", "migrated editor document", { from: fromVersion, to: EDITOR_DOCUMENT_VERSION });
    }
    /** Copy the persisted file aside before a migration overwrites it, never clobbering a prior backup. */
    backupExistingFile(fromVersion) {
        let backup = `${this.filePath}.v${fromVersion}.bak`;
        if (existsSync(backup))
            backup = `${this.filePath}.v${fromVersion}.${Date.now()}.bak`;
        copyFileSync(this.filePath, backup);
        log("info", "doc-store", "backed up editor document before migration", { backup });
    }
}
