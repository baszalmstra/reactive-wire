import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as Y from "yjs";
import {
  DEFAULT_MAX_DOC_STATE_BYTES,
  DEFAULT_MAX_DOC_UPDATE_BYTES,
  decodeUpdateBase64,
  emptyEditorDocumentSnapshot,
  encodeUpdateBase64,
  snapshotFromEditorDoc,
  applyEditorSnapshot,
  type EditorDocumentSnapshot,
} from "../../shared/collab.js";

export interface EditorDocumentStoreOptions {
  dataDir?: string;
  fileName?: string;
  maxUpdateBytes?: number;
  maxStateBytes?: number;
}

export class EditorDocumentStore {
  readonly doc: Y.Doc;
  readonly filePath: string;
  readonly maxUpdateBytes: number;
  readonly maxStateBytes: number;

  constructor(options: EditorDocumentStoreOptions = {}) {
    this.doc = new Y.Doc();
    this.maxUpdateBytes = options.maxUpdateBytes ?? DEFAULT_MAX_DOC_UPDATE_BYTES;
    this.maxStateBytes = options.maxStateBytes ?? DEFAULT_MAX_DOC_STATE_BYTES;
    this.filePath = join(options.dataDir ?? ".rw-data", options.fileName ?? "editor-doc.ydoc");
    this.loadOrSeed();
  }

  snapshot(): EditorDocumentSnapshot {
    return snapshotFromEditorDoc(this.doc);
  }

  encodeState(): Uint8Array {
    const state = Y.encodeStateAsUpdate(this.doc);
    if (state.byteLength > this.maxStateBytes) throw new Error("Collaborative document state is too large");
    return state;
  }

  encodeStateBase64(): string {
    return encodeUpdateBase64(this.encodeState());
  }

  applyBase64Update(update: string): Uint8Array {
    return this.applyUpdate(decodeUpdateBase64(update, this.maxUpdateBytes));
  }

  applyUpdate(update: Uint8Array): Uint8Array {
    if (update.byteLength > this.maxUpdateBytes) throw new Error("Document update is too large");
    const nextDoc = new Y.Doc();
    Y.applyUpdate(nextDoc, Y.encodeStateAsUpdate(this.doc), this);
    Y.applyUpdate(nextDoc, update, this);
    snapshotFromEditorDoc(nextDoc);
    const nextState = Y.encodeStateAsUpdate(nextDoc);
    if (nextState.byteLength > this.maxStateBytes) throw new Error("Collaborative document state is too large");
    Y.applyUpdate(this.doc, update, this);
    this.persist();
    return update;
  }

  persist(): void {
    const bytes = this.encodeState();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, this.filePath);
  }

  private loadOrSeed(): void {
    if (existsSync(this.filePath)) {
      const bytes = readFileSync(this.filePath);
      if (bytes.byteLength > 0) {
        if (bytes.byteLength > this.maxStateBytes) throw new Error("Persisted collaborative document state is too large");
        Y.applyUpdate(this.doc, new Uint8Array(bytes), this);
        snapshotFromEditorDoc(this.doc);
        return;
      }
    }
    applyEditorSnapshot(this.doc, emptyEditorDocumentSnapshot(), this);
    this.persist();
  }
}
