#!/usr/bin/env node
// Decode the persisted collaborative editor document and print its snapshot as JSON. Reads the
// same file the server writes: RW_DATA_DIR/editor-doc.ydoc (default .rw-data), overridable with
// RW_DOC_FILE. Imports the shared collab helper, so run it through tsx:
//   npx tsx scripts/decode-doc.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as Y from "yjs";
import { snapshotFromEditorDoc } from "../shared/collab.js";

const dataDir = process.env.RW_DATA_DIR?.trim() || ".rw-data";
const file = process.env.RW_DOC_FILE?.trim() || join(dataDir, "editor-doc.ydoc");

if (!existsSync(file)) {
  console.error(`No persisted document at ${file}. Start the server once, or set RW_DATA_DIR/RW_DOC_FILE.`);
  process.exit(1);
}

const bytes = readFileSync(file);
const doc = new Y.Doc();
Y.applyUpdate(doc, new Uint8Array(bytes));
const snapshot = snapshotFromEditorDoc(doc);

// A compact overview plus the full snapshot, so both a glance and a deep read are available.
const overview = {
  file,
  bytes: bytes.byteLength,
  version: snapshot.version,
  activeFlowId: snapshot.activeFlowId,
  settings: snapshot.settings,
  flows: snapshot.flows.map((f) => ({ id: f.id, name: f.name, nodes: f.nodes.length, edges: f.edges.length })),
  macros: Object.keys(snapshot.macros).length,
};
console.log(JSON.stringify({ overview, snapshot }, null, 2));
