# AGENTS.md

Operational guide for AI coding agents and contributors working in this repository.

**What this is:** Reactive Wire is a node-based reactive automation system for Home Assistant. A
typed graph derives an entity's desired state from other entities; one engine
(`shared/engine/evaluate.ts`) powers both the editor's preview and server actuation. Design
rationale lives in [DESIGN.md](./DESIGN.md); code comments describe behavior only.

**Run without external services:** `pixi run start` starts the server. With `HA_URL` and `HA_TOKEN`
unset it uses the built-in mock Home Assistant client and simulator. `pixi run fe-dev` starts the
editor at `http://localhost:5173`; the feed defaults to `ws://127.0.0.1:7420`.

**Safety invariant:** the server actuates nothing unless a graph is deployed **live**. Sinks dry-run
until an explicit Deploy or enabled auto-deploy, and never actuate on a non-`ok` value.
`RW_DEPLOY_TOKEN`, when set, gates WebSocket access and deploys.

**Module map:** `shared/engine/` contains pure evaluation and one NodeDef per node;
`shared/collab.ts` defines the Yjs editor document; `src/server/` contains deployment, feed, and
security; `src/ha/` contains real and mock Home Assistant clients; `frontend/src/` contains the
React Flow editor.

## Working in the repository

- Dependencies and tools come through [Pixi](https://pixi.sh). Never run bare `npm install` or
  `npm ci`; use `pixi run install-all`.
- Run `pixi run check` for every change. It type-checks the core and editor, lints the frontend, and
  runs unit tests.
- Changes to `shared/engine/` or `src/server/` require a matching unit test in `test/`.
- Use `pixi run storybook` to inspect isolated frontend components and `pixi run e2e` for
  cross-cutting editor/server or canvas interaction changes.
- Version control is [jj](https://github.com/jj-vcs/jj), colocated with git. Jj auto-snapshots the
  working copy, so there is no staging step.

## Repository skills

- `.agents/skills/reactive-wire-debug/` — inspect a running server and decode persisted editor state.
- `.agents/skills/reactive-wire-release/` — prepare and ship Home Assistant add-on releases.

Server logs are structured single lines on stdout (`src/server/log.ts`); `RW_LOG_LEVEL` controls
filtering. The editor document persists to `RW_DATA_DIR/editor-doc.ydoc` (default `.rw-data`,
git-ignored).
