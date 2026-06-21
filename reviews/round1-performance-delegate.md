Did not write `e:\projects\reactive-wire\reviews\round1-performance-delegate.md` because the task also says “Do not modify files”; no files changed.

## Findings

1. **HIGH — Yjs write amplification on every diff.**  
   `syncOrder` always deletes/re-pushes whole order arrays and uses O(n²) `includes`; `updateMapFromDiff` writes whole node/edge objects for small field changes. Refs: `shared/collab.ts:182-201`, `shared/collab.ts:236-266`.  
   Bench idea: one-node move in 1k-node/4k-edge graph should emit only that node delta; assert identical diff emits no Yjs update.

2. **HIGH — Server persists full document synchronously per update.**  
   `applyUpdate()` calls `persist()`, which `encodeStateAsUpdate()`s the whole doc and `writeFileSync`/`renameSync`s every incoming update. Refs: `src/server/doc-store.ts:47-58`. Combined with broadcasts at `src/server/feed.ts:362-366`, this can block the event loop and amplify disk writes.  
   Test idea: 100 small updates on max graph; assert persistence is batched/debounced and event-loop delay stays bounded.

3. **HIGH — Remote update path rebuilds entire frontend graph.**  
   Each `docUpdate` decodes/applies, snapshots the whole Y.Doc, maps all flows/nodes/edges to fresh objects, then `setNodes`/`setEdges`; local sync also full-`JSON.stringify`s snapshots. Refs: `frontend/src/App.tsx:119-120`, `frontend/src/App.tsx:271-286`, `frontend/src/App.tsx:310-345`, `shared/collab.ts:272-310`.  
   Bench idea: remote single-node update on 1k/4k graph should preserve unchanged node identities and stay under a frame budget.

4. **MEDIUM — Potential active-flow debounce/broadcast loop.**  
   Snapshots persist `activeFlowId`, but remote apply keeps the current local active flow if it exists, then the 180ms local sync can write that preference back. Two clients on different tabs can fight and trigger repeated doc writes. Refs: `frontend/src/App.tsx:255-269`, `frontend/src/App.tsx:279`, `frontend/src/App.tsx:337-345`.  
   Test idea: two clients with different active tabs receive each other’s updates; assert no outgoing `docUpdate` unless graph data changed.

5. **MEDIUM — WebSocket payload/backpressure gaps.**  
   Server has no `maxPayload` before `JSON.parse(String(raw))`, and broadcast sends to all open clients without checking `bufferedAmount`/slow clients. Refs: `src/server/feed.ts:320-339`, `src/server/feed.ts:364-366`.  
   Test idea: paused/slow client plus repeated large updates; assert buffered bytes are capped or client is dropped.

6. **LOW/MEDIUM — Initial bundle impact from Yjs.**  
   Yjs is now a frontend dependency and imported in the initial `App` path. Refs: `frontend/package.json:17`, `frontend/src/App.tsx:2`, `shared/collab.ts:1`. Local package shows `yjs.mjs` ~300KB raw before bundling/compression.  
   Bench idea: add bundle-size budget/metafile check; consider async collab chunk/manual vendor split.