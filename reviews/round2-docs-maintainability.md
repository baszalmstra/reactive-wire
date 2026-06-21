Did not write `reviews/round2-docs-maintainability.md` because the task also says **Do not modify files**.

Findings:

- **MED — Incoming Yjs updates can persist unsupported schema versions.** `EditorDocumentStore.applyUpdate()` applies and persists before validating schema (`src/server/doc-store.ts:47-50`), while version rejection only happens in snapshot paths (`shared/collab.ts:283-290`) and load validation (`src/server/doc-store.ts:66-67`). A future/unsupported client update could be stored and make restart fail. **Smallest fix:** validate on a temporary doc seeded from current state, call `snapshotFromEditorDoc()`, then apply/persist only if supported; return `docError` otherwise.

- **MED — Collaboration frame size contract is inconsistent/undocumented.** Client decode defaults to 2MB (`shared/collab.ts:411-421`; used at `frontend/src/App.tsx:341,359`), server sends full `docState` without a state-size cap (`src/server/feed.ts:341`) and allows larger WS payloads (`src/server/feed.ts:325`). Valid persisted docs can become unsyncable. **Smallest fix:** export shared max constants/config for update vs full state, enforce on send/receive, and document the limit/recovery path.

- **LOW — DESIGN roadmap contradicts current persistence state.** `DESIGN.md` still says Q9 persistence is “Not built” (`DESIGN.md:155-156`) while later says editor document persistence is built (`DESIGN.md:453-464`). **Smallest fix:** mark Q9 as partially complete: collaborative editor document persistence built; deployed graph/runtime memory persistence still separate.

- **LOW — Implementation artifact has stale residual risk.** `implementation/collab-worker.md` says pre-`docState` edits may be replaced (`implementation/collab-worker.md:89,200`), but current code flushes local content and uploads missing updates (`frontend/src/App.tsx:323,340-343`). **Smallest fix:** update/remove that residual-risk note.