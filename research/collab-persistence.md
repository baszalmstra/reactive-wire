# Research: Collaborative, persistent editing for Reactive Wire

## Summary
Use **Yjs with a dedicated collaboration WebSocket endpoint and durable Yjs update persistence** as the lowest-risk path for this TypeScript React + Node/WebSocket app. Yjs has the strongest OSS adoption signals, mature browser/server integration, built-in conflict-free merging, awareness/presence, and a persistence model that can survive server restarts by replaying or snapshotting binary document updates. Automerge is attractive for local-first/version-history-heavy apps but its repo/network stack is smaller and moving quickly; ShareDB is proven OT but adds server-authoritative transform complexity; a custom protocol is not recommended except for a constrained single-writer or low-concurrency MVP.

## Findings
1. **Yjs is the best default for this repo.** Yjs is a CRDT library for collaborative/offline editing with shared types that sync automatically; its updates are documented as commutative, associative, and idempotent, so clients converge once all updates are exchanged. Adoption/maintenance signals are strong: GitHub search reported ~22k stars and a June 2026 push; npm reported ~5.8M weekly downloads for `yjs`; `y-websocket` reported ~132k weekly downloads. [Yjs docs](https://docs.yjs.dev/api/document-updates), [Yjs GitHub](https://github.com/yjs/yjs/), [Yjs npm](https://www.npmjs.com/package/yjs), [y-websocket npm](https://www.npmjs.com/package/y-websocket)

2. **Integration shape for Yjs fits the current app but should use a separate protocol path.** The current server already uses `ws` for JSON entity/deploy messages in `src/server/feed.ts`; collaboration should be a separate WebSocket path or server instance so Yjs binary sync messages are not mixed with existing JSON messages. On the client, represent the editor graph as Yjs shared types, e.g. `Y.Map<NodeId, Y.Map>` for nodes, `Y.Map<EdgeId, Y.Map>` for edges, `Y.Map<MacroId, Y.Map>` for macros, and an awareness channel for cursors/selections. `y-websocket` supplies a client/server provider where the server distributes document updates and awareness. [y-websocket docs](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket)

3. **Yjs persistence options are practical.** Yjs exposes binary updates and `Y.encodeStateAsUpdate`, `Y.applyUpdate`, `Y.mergeUpdates`, and state-vector diffing APIs; those updates can be stored in any durable medium and replayed after restart. Options: (a) `y-leveldb` for a quick embedded persistence adapter, (b) custom append-only update log plus periodic compacted snapshots in SQLite/Postgres/filesystem, or (c) a higher-level Yjs server such as Hocuspocus if auth/hooks/SQLite persistence are desired later. `y-leveldb` is official but small (~115 stars in search results), so for long-lived app data a small custom store around Yjs update APIs may be safer than depending on LevelDB-specific operational behavior. [Yjs update docs](https://docs.yjs.dev/api/document-updates), [y-leveldb](https://github.com/yjs/y-leveldb), [Yjs ecosystem](https://github.com/yjs/yjs?tab=readme-ov-file)

4. **Yjs conflict behavior is acceptable for graph editing if model rules are explicit.** Concurrent additions merge. Concurrent edits to independent map keys merge. Concurrent edits to the same scalar field resolve deterministically by Yjs map/register semantics, but product rules should define whether last-writer-wins is acceptable for node position/title/config fields. For delete-vs-edit, model deletes as explicit tombstones or treat delete as authoritative and garbage-collect later; otherwise a concurrent edit can appear surprising. For edges, use stable IDs and validate endpoints after merge so dangling edges are removed or marked invalid.

5. **Automerge is credible but less direct for this app.** Automerge is also a CRDT/local-first sync engine with offline edits and consistent conflict prevention/merge behavior. The core project has solid signals (~6.3k stars, May 2026 push; npm package published Apr 2026), and `automerge-repo` provides repository abstractions, WebSocket network adapters, React hooks examples, IndexedDB storage, and Node filesystem storage. However, `automerge-repo` itself is smaller (~685 stars) and current docs/search showed alpha releases around v2.6.0; adopting it would likely require more app-specific plumbing and risk than Yjs for a graph editor. [Automerge docs](https://automerge.org/docs/hello/), [Automerge storage](https://automerge.org/docs/reference/repositories/storage/), [Automerge WebSocket adapter](https://automerge.org/automerge-repo/modules/_automerge_automerge-repo-network-websocket.html), [Automerge GitHub](https://github.com/automerge/automerge), [automerge-repo GitHub](https://github.com/automerge/automerge-repo/)

6. **ShareDB/OT is stable and server-authoritative, but it is not the simplest fit.** ShareDB is a realtime database backend based on Operational Transformation for JSON documents, with concurrent collaboration, realtime query subscriptions, and database adapters. It has mature usage signals (~6.5k stars; npm ~25k weekly downloads; releases in 2025; TypeScript conversion work in 2026). Persistence is straightforward via MongoDB or Postgres adapters, and the server remains the authoritative sequencer. Downsides: OT requires choosing/maintaining OT types (`json0`, rich-text, etc.), transform correctness depends on operation design, offline editing is harder than CRDTs, and React graph updates must be encoded as server-submitted JSON ops. [ShareDB README](https://github.com/share/sharedb), [ShareDB intro](https://share.github.io/sharedb/), [ShareDB database adapters](https://share.github.io/sharedb/adapters/database), [ShareDB npm](https://www.npmjs.com/package/sharedb)

7. **A custom operation protocol materially increases correctness risk.** A simple custom protocol would define operations such as `addNode`, `patchNode`, `moveNode`, `deleteNode`, `addEdge`, `deleteEdge`, assign server sequence numbers, persist an op log, snapshot periodically, and replay after restart. This is feasible for server-authoritative, online-only collaboration with coarse last-writer-wins fields, but it does not solve hard cases automatically: concurrent delete/edit, edge endpoint validity, duplicate IDs, reconnect gaps, undo/redo semantics, schema migrations, and offline edits. It should be considered only if collaborative editing is intentionally narrow and CRDT dependencies are rejected.

## Comparison matrix

| Option | Maintenance/popularity | Server/client integration | Persistence | Conflict behavior | Fit for Reactive Wire |
|---|---:|---|---|---|---|
| **Yjs + y-websocket + custom persistence or y-leveldb** | Strongest: `yjs` ~22k GitHub stars, ~5.8M npm weekly downloads; active 2026 signals | Add `/collab/:docId` WebSocket; client `Y.Doc` + `WebsocketProvider`; bind React graph state to `Y.Map`s | Store binary updates; compact with snapshots/`mergeUpdates`; `y-leveldb` for MVP | CRDT convergence; explicit app policy needed for same-field and delete/edit conflicts | **Recommended** |
| **Automerge + automerge-repo** | Good core; smaller repo/network layer; alpha-looking repo releases | `Repo` on client/server, WebSocket adapters, React hooks; more custom adaptation | IndexedDB client, NodeFS server, custom storage adapters | CRDT merge with conflict tools; good local-first story | Good if local-first/history is primary |
| **ShareDB/OT** | Mature but smaller usage than Yjs; ~25k npm weekly downloads | Server-authoritative ShareDB backend; client submits JSON ops | Mongo/Postgres adapters persist docs and ops | OT transforms ordered ops; offline more complex | Good if strict central authority and JSON ops are preferred |
| **Custom protocol** | App-owned only | Extend current `ws` protocol or add endpoint; design all ops | Own op log + snapshots | Must implement/define all transforms/conflicts | Not recommended for multi-user correctness |

## Concrete recommendation

Implement **Yjs with a dedicated collaboration service**:

- Start with `yjs`, `y-websocket`, and either:
  - **MVP persistence:** `y-leveldb` under `RW_DATA_DIR/collab-leveldb`, if acceptable for local embedded storage; or
  - **Preferred durable path:** custom persistence using Yjs update APIs: append every update to a document update log, periodically write compacted snapshots, and load snapshot + tail updates at server start.
- Keep the existing entity/deploy feed unchanged; add a new WebSocket route/path for Yjs documents to avoid protocol coupling.
- Treat the editor graph as a CRDT document, not a stream of UI commands. Use stable object IDs and maps keyed by ID to reduce array-index conflicts.
- Add a server-side validation layer that projects the merged Yjs document to the existing deploy graph shape and reuses/extends `sanitizeDeployRequest` before deploy.
- Add awareness/presence after persistence/convergence is working; do not persist awareness.

## Implementation checklist

1. **Document model**
   - Define `CollaborativeGraphDoc` schema: `nodes: Y.Map<Y.Map>`, `edges: Y.Map<Y.Map>`, `macros: Y.Map<Y.Map>`, `meta: Y.Map`.
   - Define conflict policies: node move/title/config last-writer-wins; delete creates tombstone; edge validation removes/flags dangling edges.
   - Add version field for future migrations.

2. **Server endpoint**
   - Add a dedicated WebSocket endpoint such as `/collab?doc=<id>&token=<token>` or a separate port.
   - Reuse existing host/origin/token checks from `feed.ts`.
   - Bind each `docId` to a server-side `Y.Doc` room.
   - On connection, sync state using Yjs/y-websocket protocol; broadcast binary updates to peers.

3. **Persistence**
   - Choose storage: `y-leveldb` for fastest MVP, or custom store for long-term control.
   - If custom: table/files `{docId, seq, updateBytes, createdAt}` plus `{docId, snapshotBytes, snapshotSeq}`.
   - On update: append bytes before broadcasting or before acknowledging durability-sensitive edits.
   - On startup/open: load snapshot, then replay tail updates with `Y.applyUpdate`.
   - Compact periodically with `Y.encodeStateAsUpdate` or `Y.mergeUpdates` and prune old tail updates after successful snapshot.

4. **Client integration**
   - Create a `Y.Doc` per editor document and connect with `WebsocketProvider`.
   - Convert local React editor actions into `ydoc.transact` mutations.
   - Observe Yjs maps to update React state; debounce expensive layout/render recalculation.
   - Add awareness for user cursors, selected node IDs, and display names/colors.
   - Add reconnect status and unsynced/durable status indicators.

5. **Deploy integration**
   - Project Yjs document to `{nodes, edges, macros}`.
   - Run existing deploy sanitization/validation on projection.
   - Deploy explicit snapshots only; do not actuate Home Assistant merely because a remote collaborator is editing.

6. **Testing/TDD recommendations**
   - Unit-test graph projection both directions: app state -> Yjs doc -> deploy graph.
   - Unit-test conflict policies: concurrent move/move, edit/delete, add edge/delete node, duplicate edge IDs.
   - Convergence tests: create two or three `Y.Doc`s, apply randomized operations offline, exchange updates in varied orders, assert identical projected graph.
   - Persistence restart tests: apply updates, close server/doc, reload from store, assert exact projection; include snapshot + tail replay.
   - WebSocket integration tests: two clients edit same doc concurrently and both converge; third client connects after restart and receives persisted state.
   - Security tests: invalid origin/host/token rejected on collaboration endpoint; unauthorized doc IDs rejected.
   - Regression tests for deploy safety: collaborative edits never trigger deploy without explicit deploy action.

## Sources
- Kept: Yjs document updates docs (https://docs.yjs.dev/api/document-updates) — primary evidence for update semantics and persistence APIs.
- Kept: y-websocket docs (https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) — primary evidence for WebSocket provider integration and awareness/sync shape.
- Kept: Yjs GitHub/npm (https://github.com/yjs/yjs/, https://www.npmjs.com/package/yjs) — maintenance/popularity signals.
- Kept: y-leveldb (https://github.com/yjs/y-leveldb) — official embedded persistence option.
- Kept: Automerge docs and GitHub (https://automerge.org/docs/hello/, https://automerge.org/docs/reference/repositories/storage/, https://github.com/automerge/automerge, https://github.com/automerge/automerge-repo/) — primary evidence for CRDT behavior, storage, network adapters, and maintenance signals.
- Kept: ShareDB docs/GitHub/npm (https://share.github.io/sharedb/, https://share.github.io/sharedb/adapters/database, https://github.com/share/sharedb, https://www.npmjs.com/package/sharedb) — primary evidence for OT backend, database adapters, and popularity.
- Dropped: SEO/case-study collaborative-editor blog posts — not primary library evidence.
- Dropped: Generic CRDT-vs-OT commentary posts — useful background but less authoritative than official docs and repositories.

## Gaps
- I did not run npm/GitHub API calls directly; popularity/maintenance numbers come from web search result extracts and may change.
- I did not inspect the full React editor code path, only the root package and existing WebSocket server/feed files available via reads, so exact component binding details need follow-up during implementation.
- The best storage choice depends on expected deployment topology: single local server favors embedded LevelDB/SQLite; multi-instance hosting needs a shared DB or a scalable Yjs backend.

## Supervisor coordination
No supervisor decision was needed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Created only the requested research artifact at research/collab-persistence.md; no implementation scope was widened."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Brief includes direct recommendation, comparison of Yjs/Automerge/ShareDB/custom protocol, integration and persistence options, conflict behavior, testing/TDD checklist, and inline source links from official docs/repos/npm pages."
    }
  ],
  "changedFiles": [
    "research/collab-persistence.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search: Yjs, Automerge, ShareDB, custom protocol research queries",
      "result": "passed",
      "summary": "Collected primary docs, repository, npm, and comparison evidence."
    },
    {
      "command": "fetch_content: official Yjs, Automerge, ShareDB docs/repos",
      "result": "passed",
      "summary": "Fetched authoritative source content for implementation and persistence details."
    },
    {
      "command": "read: package.json and src/server/feed.ts",
      "result": "passed",
      "summary": "Confirmed the repo is TypeScript/Node/ws and currently uses a JSON WebSocket feed/deploy protocol."
    },
    {
      "command": "write: research/collab-persistence.md",
      "result": "passed",
      "summary": "Wrote the requested evidence-backed research brief."
    }
  ],
  "validationOutput": [
    "Artifact written to e:\\projects\\reactive-wire\\research\\collab-persistence.md"
  ],
  "residualRisks": [
    "No shell/git tool was available, so git status/no-staged-files could not be independently verified; this task did not invoke any staging operation.",
    "Popularity numbers are from search result extracts as of 2026-06-20 and should be rechecked before dependency approval."
  ],
  "noStagedFiles": true,
  "notes": "No tests were added because the requested deliverable was research only; no source implementation files were changed."
}
```