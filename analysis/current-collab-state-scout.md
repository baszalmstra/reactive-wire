# Code Context

## Files Retrieved
1. `frontend/src/App.tsx` (lines 1-120, 172-178, 240-379, 522-528) - editor state owners, Yjs bridge, remote/local sync effects, auto-deploy guard.
2. `frontend/src/server-conn.ts` (lines 1-115) - browser WebSocket hook and protocol demux for entities, deploy, docState/docUpdate/docError.
3. `shared/collab.ts` (lines 1-120, 121-220, 250-413) - shared collaborative document schema, sanitization, Y.Doc snapshot/diff materialization, base64 update helpers.
4. `src/server/feed.ts` (lines 1-120, 331-442) - WebSocket server, connection validation, docState initial send, docUpdate apply/broadcast, entity feed loop.
5. `src/server/doc-store.ts` (lines 1-76) - persistent server-side Y.Doc store, validation-before-commit, atomic file persistence.
6. `src/server/index.ts` (lines 45-57) - production wiring of `EditorDocumentStore` into `startFeed`.
7. `test/collab.test.ts` (lines 1-159) - model/store coverage: sanitization, concurrent merge, no-op diffs, version rejection, persistence.
8. `test/feed-collab.test.ts` (lines 1-176) - feed protocol coverage: initial state, broadcast, invalid frames, restart persistence.

## Key Code

- `frontend/src/App.tsx:126-176` owns most UI/editor state directly in React: active canvas `nodes`/`edges`, inactive `flows`, `activeFlowId`, macro library, undo/redo, deploy flags, live HA/sim entities, evaluation memory/results, and Yjs refs (`collabDoc`, `collabReady`, `applyingCollab`, `lastCollabSnapshot`).
- `frontend/src/App.tsx:255-272` builds a full `EditorDocumentSnapshot` from React state. Active tab is intentionally not collaborative; it persists only a stable fallback `activeFlowId`.
- `frontend/src/App.tsx:276-302` applies a remote snapshot back into React state, clears selection/history, replaces macros, and suppresses the next auto-deploy.
- `frontend/src/App.tsx:308-316` is the local React -> Yjs seam: guarded by readiness/applying flags, compares JSON snapshots, then calls `applyEditorSnapshotDiff`.
- `frontend/src/App.tsx:328-367` is the Yjs/WebSocket receive/send loop:
  - document `update` events send to server unless from `collabServerOrigin` or before ready;
  - `docState` merges initial server state, uploads offline-missing updates, then renders snapshot;
  - `docUpdate` flushes pending local React edits before applying remote update.
- `frontend/src/server-conn.ts:43-114` keeps transport state (`connected`, `entities`, `lastResult`, `docState`, `docUpdate`, `docError`) and reconnects every 1500ms. It only stores latest doc frames with a monotonically increasing nonce.
- `shared/collab.ts:12-31` defines the persisted model boundary: `EditorDocumentSnapshot = { version, activeFlowId?, flows[], macros }`; flows contain serializable `CollabNode[]` and `CollabEdge[]`.
- `shared/collab.ts:42-159` sanitizes hostile/oversized snapshots: safe keys, depth/item caps, strips `selected`, caps flows/nodes/edges/macros, drops dangling edges.
- `shared/collab.ts:284-343` materializes full snapshots/diffs into nested Y.Maps/Y.Arrays. Nested maps allow concurrent edits to different node fields to merge.
- `shared/collab.ts:362-390` derives a sanitized snapshot from a Y.Doc and orders values via explicit order arrays plus sorted fallback.
- `src/server/doc-store.ts:38-51` validates updates on a cloned doc and size-checks the resulting state before mutating/persisting the real doc.
- `src/server/feed.ts:347-397` sends initial `docState`, accepts authenticated `docUpdate`, applies it to store, then broadcasts to all other clients (not echoing sender).
- `src/server/feed.ts:425-439` separately throttles HA entity broadcast every 150ms and closes clients whose buffer exceeds max payload.

## Architecture

State currently lives in three overlapping layers:

1. **React editor working state** (`frontend/src/App.tsx`): mutable UI source for canvas interactions. Active flow uses top-level `nodes`/`edges`; inactive flows are stored in `flows`. Macros are managed by `useMacros`; undo/redo and selection are local only.
2. **Client Y.Doc mirror** (`frontend/src/App.tsx` + `shared/collab.ts`): normalized collaborative document generated from React snapshots and rendered back into React after server/peer updates.
3. **Server Y.Doc persistence** (`src/server/doc-store.ts`): authoritative durable Y.Doc stored at `.rw-data/editor-doc.ydoc` by default and exposed through `src/server/feed.ts`.

Synchronization loops:

- **Local edit loop:** React state changes -> 180ms debounce (`App.tsx:374-378`) -> `flushLocalDocumentToCollab` -> `applyEditorSnapshotDiff` -> Yjs `update` event -> `server.sendDocUpdate`.
- **Initial/reconnect loop:** WebSocket connects -> feed sends `entities` and `docState` -> App flushes pre-ready user content into local Y.Doc -> applies server state -> computes/uploads missing offline diff -> renders merged snapshot.
- **Remote peer loop:** server receives `docUpdate` -> validates/persists -> broadcasts to other clients -> App flushes pending local edits, applies remote update, snapshots Y.Doc, renders React.
- **Runtime/feed loop:** HA entity feed -> server broadcasts `entities` at most every 150ms -> `useServer` updates `entities` -> App evaluates preview results; deploy is a separate explicit/auto loop.

Failure modes and risks:

- `App.tsx` is a large bidirectional adapter. React state and Y.Doc can diverge if an update occurs while `applyingCollab` is true or during the 180ms debounce; current comments/flushes address known loss cases but the seam is fragile.
- `snapshotEqual` uses `JSON.stringify` (`App.tsx:120-122`), so object key order and large documents can cause costly or spurious comparisons.
- Server broadcasts `docUpdate` to other clients only (`feed.ts:388-394`); the sender relies on its local Y.Doc and receives only `docError` on rejection. If `applyUpdate` transforms/sanitizes differently from the sender expectation, sender may remain visually divergent until reconnect.
- `useServer` stores only the latest `docUpdate` packet (`server-conn.ts:54-75`). React effects normally process each nonce, but a burst before render could collapse frames; Yjs updates are commutative but not necessarily safe to drop if they are incremental and not state-vector independent.
- `docError` is a sticky string (`server-conn.ts:72-75`); repeated identical errors may not retrigger UI because state value is unchanged.
- Offline edits upload on reconnect via `sendLocalUpdatesMissingFromServerState` (`App.tsx:318-326`) but failure is only surfaced as toast; no retry queue beyond future local updates/reconnect.
- Persistence is synchronous file I/O per accepted update (`doc-store.ts:53-60`), acceptable for small local use but a scalability/backpressure seam.
- Collaborative document includes full node `data` blobs (`shared/collab.ts:12-24`, `App.tsx:101-107`); runtime deploy uses a different sanitized graph (`feed.ts:123-219`). Model boundaries are related but not identical.

## Refactor seams / proposed state model boundaries

1. **EditorDocument adapter module:** extract `localDocumentSnapshot`, `applyRemoteDocumentSnapshot`, node/edge conversion, and equality from `App.tsx` into a pure adapter around `{ flows, activeFlowId, nodes, edges, macros } <-> EditorDocumentSnapshot`. This gives tests for the React/Yjs boundary without mounting App.
2. **Client collab controller hook:** extract `collabDoc`, readiness/applying flags, debounce, docState/docUpdate effects, and offline missing-update logic into `useCollaborativeDocument(server, adapter)`. App should receive `{ready, error, applyLocalDraft}` rather than own transport synchronization details.
3. **Transport event log boundary:** replace latest `docUpdate`/`docState` React state with queued or callback-based protocol events in `useServer`, preserving all incremental updates and making repeated `docError`s observable.
4. **Authoritative document boundary:** keep `shared/collab.ts` as the only schema/sanitization layer for editor documents. Avoid leaking ReactFlow-only fields like `selected`; already stripped in both App and sanitizer.
5. **Runtime deployment boundary:** keep deploy graph separate from editor document. Deploy should consume a derived, validated runtime graph from active flow + macros; do not make server doc persistence imply actuation.
6. **Local-only UI boundary:** selection, undo/redo, active tab preference, panels, toasts, simulated entities, evaluation memory/results should remain local and not enter `EditorDocumentSnapshot`.

## Start Here

Start with `frontend/src/App.tsx` around lines 255-379. That is the central seam where React editor state is converted to Yjs, remote Yjs snapshots are rendered back, and WebSocket doc frames are handled. Any refactor should first isolate this block behind a smaller state/document adapter.

## Commands run

- `ls .`
- `find frontend/src -name '*.ts*'`
- `find shared -name '*.ts'`
- `find src/server -name '*.ts'`
- `find test -name '*.ts*'`
- `read`/`grep` on the files listed above
- `git status --short && mkdir -p analysis`
- `git diff --cached --name-only`

## Validation notes

No tests were run; this was a scout/read-only task. The only file written is this analysis artifact. `git diff --cached --name-only` returned no output, so there are no staged files. The working tree already contained many modified/untracked files before this report was written.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Inspected only requested collaboration/state-management areas and wrote findings to analysis/current-collab-state-scout.md without modifying source or tests."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report includes exact file/line refs, state ownership, synchronization loops, failure modes, refactor seams, commands run, and validation notes."
    }
  ],
  "changedFiles": ["analysis/current-collab-state-scout.md"],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "ls/find/read/grep targeted repository inspection",
      "result": "passed",
      "summary": "Mapped requested frontend, shared, server, and test files."
    },
    {
      "command": "git status --short && mkdir -p analysis",
      "result": "passed",
      "summary": "Confirmed pre-existing worktree changes and ensured analysis directory exists."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files reported."
    }
  ],
  "validationOutput": ["git diff --cached --name-only produced no output"],
  "residualRisks": ["No tests run because this was a read-only scouting task.", "Working tree had many pre-existing modified/untracked files; only the analysis artifact was intentionally written."],
  "noStagedFiles": true,
  "notes": "Source files were not modified."
}
```
