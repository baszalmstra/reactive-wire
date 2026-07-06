# AGENTS.md

Operational guide for any AI coding agent (or new human) working in this repo. Everything here is
tool-agnostic; `CLAUDE.md` carries the same operational content for Claude Code and defers to the
guides below.

**What this is:** Reactive Wire — a node-based reactive automation system for Home Assistant. A
typed graph derives an entity's desired state from other entities; one engine
(`shared/engine/evaluate.ts`) powers both the editor's live preview and the server's actuation.
Design rationale lives in [DESIGN.md](./DESIGN.md); code comments describe behavior only.

**Run with zero external dependencies:** `pixi run start` (server; with `HA_URL`/`HA_TOKEN` unset
it uses a built-in mock HA + simulator, feed on `ws://127.0.0.1:7420`) and `pixi run fe-dev`
(editor on `http://localhost:5173`). Never run bare `npm install`/`npm ci` — dependencies come
through `pixi` (`pixi run install-all`).

**Safety invariant:** the server actuates nothing unless a graph is deployed **live**; sinks
dry-run (log instead of call) until an explicit Deploy or enabled auto-deploy, and never actuate on
a non-`ok` value. `RW_DEPLOY_TOKEN`, when set, gates deploys.

**Module map:** `shared/engine/` pure evaluation (one NodeDef per node) · `shared/collab.ts` Yjs
editor-document model · `src/server/` deployer/feed/security · `src/ha/` real + mock HA clients ·
`frontend/src/` React Flow editor.

## Guides

- [docs/agents/verify-change.md](./docs/agents/verify-change.md) — the verification ladder:
  what to run for which kind of change, and the unit-test rule.
- [docs/agents/debug-live.md](./docs/agents/debug-live.md) — inspect a running server:
  mock-mode startup, the `debugState` introspection message (`node scripts/query-state.mjs`),
  decoding the persisted editor document (`npx tsx scripts/decode-doc.mjs`).
- [docs/agents/review-rounds.md](./docs/agents/review-rounds.md) — multi-round review process
  for large or cross-cutting diffs.

## Repo mechanics

Version control is [jj](https://github.com/jj-vcs/jj), colocated with git (jj auto-snapshots; no
staging step). Server logs are structured single lines on stdout (`src/server/log.ts`,
`RW_LOG_LEVEL` filters). The editor document persists to `RW_DATA_DIR/editor-doc.ydoc` (default
`.rw-data`, git-ignored).
