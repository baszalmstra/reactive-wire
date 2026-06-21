I did not write `e:\projects\reactive-wire\analysis\collab-state-transport-synthesis.md` because the task also says “Do not modify files.” Proposed file contents:

# Implementation Plan

## Goal
Move Reactive Wire collaboration from custom base64 JSON document frames to a standard binary Yjs sync architecture while making the Y.Doc the durable editor source of truth and preserving explicit deploy safety.

## Recommendation

Adopt the **standard y-websocket/Yjs binary sync protocol on a dedicated collaboration endpoint implemented inside Reactive Wire**, not the current custom `docState`/`docUpdate` frames.

Do **not** keep the custom base64 JSON frames long term. They duplicate protocol work, can drop burst updates in `frontend/src/server-conn.ts`, and make reconnect/state-vector behavior fragile.

Do **not** adopt Hocuspocus first. Hocuspocus is a good future option if Reactive Wire needs richer auth hooks, awareness rewriting, or managed persistence extensions, but the first migration should preserve the existing server validation model in `src/server/doc-store.ts` and `shared/collab.ts`.

Implement first:
1. Restore compile/test health around `EditorDocSyncStore`.
2. Split collaboration from the live entity/deploy feed.
3. Add binary Yjs sync/state-vector transport.
4. Then refactor frontend state so the client `Y.Doc` becomes the editor document source of truth.

## Tasks

1. **Restore current collaboration test/typecheck baseline**
   - File: `src/server/feed.ts`
   - Changes: Align `EditorDocSyncStore` with actual `EditorDocumentStore` usage: include `maxStateBytes` and `encodeStateBase64`, or stop requiring those members before migration.
   - Acceptance: `npm run typecheck` and current collab tests pass before transport refactor.

2. **Introduce a dedicated binary collaboration endpoint**
   - New file: `src/server/collab-ws.ts`
   - Changes: Handle Yjs binary sync messages using `y-protocols/sync`; reserve awareness support via `y-protocols/awareness`.
   - Acceptance: Two clients connecting to the collab endpoint converge without `docState`/`docUpdate` JSON frames.

3. **Keep feed/deploy WebSocket separate from document sync**
   - File: `src/server/feed.ts`
   - Changes: Retain entity streaming and deploy handling only; remove or deprecate document frame handling after migration compatibility tests pass.
   - File: `frontend/src/server-conn.ts`
   - Changes: Remove `docState`, `docUpdate`, `docError`, and `sendDocUpdate` from the feed hook once frontend uses the collab provider.
   - Acceptance: Entity updates and deploy results still work without carrying editor document traffic.

4. **Use the client Y.Doc as the collaborative document source of truth**
   - File: `frontend/src/App.tsx`
   - New file: `frontend/src/state/editor-store.ts`
   - Changes: Move Y.Doc ownership, sync readiness, remote apply, and local transaction handling into an external editor store/hook.
   - Acceptance: React Flow renders from Yjs-backed selectors; durable editor state is not duplicated as independent React state.

5. **Preserve local-only UI boundaries**
   - File: `frontend/src/App.tsx`
   - Changes: Keep selection, viewport, panels, toasts, preview/evaluation state, undo UI state, and active tab preference local.
   - Acceptance: Remote updates do not force collaborators onto another active tab and do not auto-deploy.

6. **Move persistence to append-log plus compacted snapshots**
   - File: `src/server/doc-store.ts`
   - Changes: Keep existing `.rw-data/editor-doc.ydoc` as the initial compacted snapshot format; add per-update binary append log with sequence/checksum metadata; compact periodically.
   - Acceptance: Server restart loads snapshot plus tail log and restores all accepted updates.

7. **Fix durable acceptance order**
   - File: `src/server/doc-store.ts`
   - Changes: Validate on shadow doc, durably write update/log entry, then mutate authoritative in-memory doc and broadcast.
   - Acceptance: If persistence fails, the live doc is not advanced and no invalid update is broadcast.

8. **Retain `shared/collab.ts` as the schema/sanitization boundary**
   - File: `shared/collab.ts`
   - Changes: Keep `EditorDocumentSnapshot`, sanitizer, Y.Doc materialization, version rejection, size limits, and ReactFlow transient-field stripping.
   - Acceptance: Server rejects unsupported versions, oversized docs, malicious keys, dangling edges, and invalid projections.

9. **Add migration compatibility**
   - File: `src/server/doc-store.ts`
   - Changes: Continue loading existing `editor-doc.ydoc` binary snapshots. Decode legacy base64 only at old protocol boundaries during rollout.
   - Acceptance: Existing persisted docs load unchanged through the new sync endpoint.

10. **Add transport and persistence tests**
   - New file: `test/collab-ws.test.ts`
   - File: `test/feed-collab.test.ts`
   - File: `test/collab.test.ts`
   - Changes: Cover binary sync between clients, reconnect/state-vector catchup, restart persistence, invalid update rejection, no deploy on document sync, and legacy persistence loading.
   - Acceptance: `npm run test` passes.

## Files to Modify

- `package.json` - add `y-protocols` and likely `y-websocket` client dependency.
- `src/server/feed.ts` - remove/deprecate custom document frames and keep feed/deploy responsibilities.
- `src/server/doc-store.ts` - append-log persistence, durable acceptance order, binary snapshot compatibility.
- `src/server/index.ts` - start the dedicated collaboration endpoint alongside feed/deploy.
- `shared/collab.ts` - retain schema boundary; possibly add binary helper exports and remove legacy message types later.
- `frontend/src/server-conn.ts` - stop carrying collab document frames.
- `frontend/src/App.tsx` - extract collaboration and editor document state into a store/hook.
- `test/collab.test.ts` - expand persistence/model regressions.
- `test/feed-collab.test.ts` - reduce to feed/deploy separation or legacy compatibility coverage.

## New Files

- `src/server/collab-ws.ts` - standard binary Yjs sync endpoint.
- `src/server/doc-manager.ts` - optional later multi-document manager keyed by safe `docId`.
- `frontend/src/state/editor-store.ts` - Yjs-backed editor document external store.
- `frontend/src/state/use-collaborative-document.ts` - frontend provider/store integration hook.
- `test/collab-ws.test.ts` - binary sync endpoint integration tests.

## Dependencies

- Task 1 must happen before meaningful migration.
- Task 2 depends on adding Yjs protocol dependencies.
- Task 3 depends on Task 2 being available.
- Task 4 depends on Task 2 for live sync but can start by wrapping current Y.Doc logic.
- Task 6 and Task 7 should land before removing legacy frames.
- Tests in Task 10 should be added alongside each implementation step.

## Risks

- `context.md` was not present at `e:\projects\reactive-wire\context.md`; this plan is based on provided prior outputs and targeted code reads.
- Standard y-websocket protocol does not naturally include Reactive Wire-specific `docAck`; avoid reintroducing custom document frames unless durable acks become a hard requirement.
- Hocuspocus may still be preferable later for production auth/presence hooks, but adopting it first would obscure current validation and persistence semantics.
- React Flow drag events can create excessive Yjs updates unless batched.
- Auto-deploy must remain origin-aware: remote/replayed/offline sync must not actuate Home Assistant.
- Current full-snapshot diffing is acceptable for migration but should be replaced on hot paths with direct Yjs transactions.