Did not write `reviews/round1-tests-delegate.md` because the task also says “Do not modify files.” Findings:

## Missing test coverage

- **Multi-user live editing is only one-way / add-only.** Existing tests cover concurrent adds in `test/collab.test.ts:43-65` and one A→B WS update in `test/feed-collab.test.ts:67-101`. Add tests for bidirectional edits over `startFeed` and convergence after both clients edit before receiving each other’s update (`src/server/feed.ts:348-366`).

- **Same-node edit conflicts are untested.** `updateMapFromDiff` stores whole node objects (`shared/collab.ts:186-196`), so concurrent edits to different fields on the same node may lose one side. Add a test defining expected behavior for move+config/title edits on the same node.

- **Delete/edit conflict policy is untested.** No test covers one client deleting a node/edge while another edits it. Add tests around `applyEditorSnapshotDiff` (`shared/collab.ts:231-263`) to lock delete-wins vs edit-wins behavior.

- **Dangling collaborative edges are untested.** Deploy validation rejects unknown-node edges in `test/feed.test.ts:24-31`, but collab sanitization accepts edges without checking node IDs (`shared/collab.ts:90-99`, `shared/collab.ts:122-134`). Add tests that deleted/missing nodes do not leave persisted/projected dangling edges.

- **Invalid `docUpdate` frames are untested.** `feed.ts` has error paths for missing/non-string/bad/oversized updates (`src/server/feed.ts:348-369`; size check in `shared/collab.ts:322-330`), but no tests assert `docError`, no broadcast, and unchanged store.

- **Security rejection is not exercised on the collab path.** Existing connection guard unit tests cover `validateConnection` (`test/feed.test.ts:58-76`), but no WS integration test proves rejected token/origin/host cannot receive `docState` or mutate `documentStore` (`src/server/feed.ts:292-295`, `src/server/feed.ts:331-366`).

- **Restart is store-only, not feed/reconnect-level.** `test/collab.test.ts:68-79` covers `EditorDocumentStore` reload, but add a WS test: stop feed, recreate store/feed, connect a new client, assert `docState` contains persisted edits (`src/server/doc-store.ts:62-72`, `src/server/feed.ts:331-334`).

- **Frontend projection has no tests.** Critical snapshot/apply effects in `frontend/src/App.tsx:255-348` and React Flow bindings at `frontend/src/App.tsx:1042-1045` are untested. Add/extract tests for app-state → collab snapshot → remote projection preserving flows/macros/comments/edges and clearing transient `selected`.