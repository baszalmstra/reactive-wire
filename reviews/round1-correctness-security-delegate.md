Did not write `reviews/round1-correctness-security-delegate.md` because the task also said “Do not modify files.”

## Findings

1. **HIGH — Local edits before first `docState` are silently lost.**  
   `flushLocalDocumentToCollab()` no-ops until `collabReady` (`frontend/src/App.tsx:297-303`), but first `docState` then applies server state and overwrites React state (`frontend/src/App.tsx:329-336`, `:284-285`).  
   **Failing test idea:** edit/add a node before initial `docState`; deliver empty persisted state; expect local node preserved/queued, currently replaced.

2. **HIGH — Remote collaborative edits can trigger Home Assistant deploy via auto-deploy.**  
   Remote `docUpdate` mutates local graph state (`frontend/src/App.tsx:343-352`); auto-deploy deploys on any `graphSig` change (`frontend/src/App.tsx:512-517`). A collaborator can cause actuation through another client with auto-deploy enabled.  
   **Failing test idea:** enable auto-deploy, inject remote doc update adding/changing sink graph, assert `deploy` is not called without explicit local action.

3. **HIGH — Client marks updates as baseline before server durability/acceptance.**  
   Local diff immediately advances `lastCollabSnapshot` (`frontend/src/App.tsx:299-303`), while `sendDocUpdate` only checks socket open/no ack (`frontend/src/server-conn.ts:122-127`); server rejection is only `docError` (`src/server/feed.ts:361-369`). Rejected/persist-failed updates won’t retry and can be lost on tab close.  
   **Failing test idea:** server with tiny `maxUpdateBytes` or persist throwing; local edit should remain dirty/retry, currently becomes baseline.

4. **HIGH — Exposed bind without token can be bypassed with spoofed loopback Host/no Origin.**  
   `RW_HOST` can bind non-loopback (`src/server/index.ts:16`), but default host check trusts `Host: 127.0.0.1` (`src/server/feed.ts:247-250`), no Origin is allowed (`:258-259`), and no token is required when unset (`:284-295`). This now exposes persisted doc read/write plus deploy.  
   **Failing test idea:** `validateConnection` with `{host:"0.0.0.0", deployToken:undefined}` and request `Host: 127.0.0.1`, no Origin should reject.

5. **HIGH — Concurrent edits to different fields of the same node/macro clobber whole objects.**  
   `updateMapFromDiff` stores entire node/edge JSON at one Y.Map key (`shared/collab.ts:191-199`); macros do the same (`:304-307`). Concurrent move vs config edit on same node loses one side by Yjs register conflict.  
   **Failing test idea:** two clients start same node; A moves position, B changes config/title; exchange updates; expect both fields, currently one object wins.