Did not write `e:\projects\reactive-wire\reviews\round2-tests.md` because the task also says “Do not modify files.” No files changed. `npm test` passes: 168 tests.

## Findings

1. **Frontend first-sync/local-edit preservation is still untested.**  
   Refs: `frontend/src/App.tsx:307-323`, `frontend/src/App.tsx:338-347`.  
   Add a collab harness/App test: make a local node edit before initial `docState`, deliver empty server state, assert the node remains rendered and `sendDocUpdate()` is called with the missing Yjs diff.

2. **Remote updates suppressing auto-deploy needs a security regression test.**  
   Refs: `frontend/src/App.tsx:275-277`, `frontend/src/App.tsx:527-534`.  
   Test idea: with fake connected server and auto-deploy enabled, inject a remote `docUpdate` that changes a sink graph; advance timers past 400ms; assert `deploy()` is not called. Then make a local edit and assert auto-deploy does call `deploy()`.

3. **WebSocket auth is unit-tested but not integration-tested for collab document leakage/mutation.**  
   Refs: `test/feed.test.ts:57-83`, `src/server/feed.ts:330-342`, `src/server/feed.ts:356-383`.  
   Add `startFeed` tests with `documentStore` + `deployToken`: connect without/wrong token or disallowed origin, assert handshake fails/no `docState`, and store snapshot remains unchanged; valid token should receive `docState`.

4. **Delete/edit conflict policy is still uncovered.**  
   Refs: `test/collab.test.ts:55`, `test/collab.test.ts:86`, `shared/collab.ts:318-341`.  
   Add Yjs concurrency tests where client A deletes a node/edge while client B edits that node or adds an edge to it; apply updates in both orders and assert deterministic convergence, e.g. delete-wins with dangling edges pruned.

5. **Bad encoded/oversized `docUpdate` paths need real feed tests.**  
   Refs: `test/feed-collab.test.ts:110`, `src/server/feed.ts:370-383`, `shared/collab.ts:411-414`.  
   Existing invalid-frame test only covers non-string updates. Add corrupt-base64 and `maxUpdateBytes` overflow cases asserting `docError`, no broadcast to peers, and unchanged persisted snapshot.

6. **Collab snapshot prototype-pollution sanitization lacks tests.**  
   Refs: `shared/collab.ts:76-90`, `shared/collab.ts:124-135`; deploy-only coverage at `test/feed.test.ts:34`.  
   Add a collab/store test with malicious node `data` and `macros` containing `__proto__`, `constructor`, and `prototype`; assert sanitized snapshots/drop on reload and `Object.prototype` is unpolluted.