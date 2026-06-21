No files changed. I did not write `e:\projects\reactive-wire\reviews\round2-performance.md` because the task also says “Do not modify files.”

## Round 2 performance findings

1. **HIGH — Full synchronous persistence per doc update remains.**  
   `src/server/feed.ts:370-371` applies each inbound `docUpdate`; `src/server/doc-store.ts:47-59` immediately `encodeStateAsUpdate()`s the whole Y.Doc and `writeFileSync`/`renameSync`s it. This blocks the event loop and amplifies every small edit into a full-file write.  
   **Bench:** 1k small node-move updates on a large doc; track event-loop delay and bytes written. Expect batched async writes or append-log + compaction.

2. **HIGH — Frontend still rebuilds whole documents for small remote/local edits.**  
   `frontend/src/App.tsx:255-314` builds/stringifies full snapshots for local sync; `frontend/src/App.tsx:354-362` snapshots the whole Y.Doc on each remote update, then `applyRemoteDocumentSnapshot` replaces all flows/nodes/edges at `frontend/src/App.tsx:275-290`. `shared/collab.ts:372-388` traverses all nodes/edges.  
   **Bench:** remote single-node move in 1k-node/4k-edge graph; assert commit stays under frame budget and unchanged node identities are preserved.

3. **MEDIUM — Order arrays still rewrite whole Y.Arrays.**  
   `shared/collab.ts:200-204` deletes/re-pushes entire arrays; `shared/collab.ts:248-273` calls it for node/edge order changes. Adding/removing one node can create O(n) Yjs updates/tombstones.  
   **Bench:** add one node to a 1k-node flow; compare emitted update size/doc growth against an incremental insert/delete implementation.

4. **MEDIUM — Client WebSocket send path has no backpressure/coalescing.**  
   `frontend/src/App.tsx:329-333` sends every local Y update; `frontend/src/server-conn.ts:123-129` calls `ws.send` without checking `bufferedAmount`. Server outbound guards improved, but slow uplinks/servers can still grow browser buffers.  
   **Bench:** throttle upload or pause server reads while dragging; assert client buffered bytes are capped and updates coalesce/drop safely.

5. **MEDIUM — Manual chunks are static/eager, not initial-load deferral.**  
   `frontend/vite.config.ts:10-12` splits `yjs`/React Flow, but `frontend/src/App.tsx:2` and `frontend/src/App.tsx:64-69` statically import them, so Vite will still load/preload them on startup.  
   **Bench:** build with metafile/coverage; enforce initial JS gzip/parse budget or lazy-load collaboration code if startup size matters.