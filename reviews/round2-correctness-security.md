Review-only note: I did not write `e:\projects\reactive-wire\reviews\round2-correctness-security.md` because the task also says “Do not modify files.”

## Findings

1. **HIGH — Pre-`docState` local edits are still nondeterministically lost.**  
   `frontend/src/App.tsx:340-343` flushes local edits into a blank Y.Doc before applying server state. That path initializes its own default `flow-1` (`frontend/src/App.tsx:307-314`, `shared/collab.ts:283-313`). The server state has a separate `flows["flow-1"]` Y.Map, so Yjs resolves the whole flow entry by clientID; either local pre-state edits or persisted server content can lose.  
   **Failing test idea:** set `server.clientID > client.clientID`; initialize both independently, add a local node before applying server state, then apply `docState` + “missing” diff. Expect local node preserved; currently it disappears.

2. **HIGH — Valid Yjs updates can poison persisted doc state and break restart.**  
   `src/server/feed.ts:370-371` accepts any syntactically valid Yjs update; `src/server/doc-store.ts:47-50` applies and persists it without validating the resulting editor document. A client can set `meta.version = 999`; later `snapshotFromEditorDoc` throws (`shared/collab.ts:283-290`) and restart fails during load (`src/server/doc-store.ts:62-67`).  
   **Failing test idea:** send a docUpdate that only changes `doc.getMap("meta").set("version", 999)`. Expect `docError` and unchanged store; currently it persists and reload throws.

3. **HIGH — Nested concurrent merge still clobbers macro/pin arrays.**  
   `shared/collab.ts:212-225` only recurses into plain objects; arrays are stored as last-writer-wins scalar values. Macro updates use this path (`shared/collab.ts:345-348`), so concurrent edits to different nodes inside `macro.nodes`, `macro.edges`, or pin arrays still lose one side.  
   **Failing test idea:** two clients edit different nodes inside the same macro definition and exchange updates. Expect both inner node changes; currently one array wins by clientID.