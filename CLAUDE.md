# CLAUDE.md

Guidance for AI agents working in this repo. The [README](./README.md) is the human-facing
tour; this file is the operational companion, and [AGENTS.md](./AGENTS.md) carries the same
content for any other agent — the detailed guides live in `docs/agents/`. Design rationale lives
in [DESIGN.md](./DESIGN.md);
**code comments describe behavior only — never cite design ids, past refactors, or future work.**

## What this is

Reactive Wire is a node-based reactive automation system for Home Assistant: you wire a typed
graph where an entity's desired state is *derived* from other entities, and any input change
re-derives the output. One engine (`shared/engine/evaluate.ts`) powers both the editor's live
preview and the server's live actuation.

## Run it with zero external dependencies

No Home Assistant, token, or network is needed — with `HA_URL`/`HA_TOKEN` unset the server runs a
built-in mock HA plus a simulator.

```sh
pixi run start     # server: mock HA + simulated entities, feed on ws://127.0.0.1:7420
pixi run fe-dev    # editor: http://localhost:5173 (shows DEMO until a server is up)
```

Do **not** run bare `npm install` / `npm ci` — `node_modules` is a shared junction. Toolchain and
dependencies come through `pixi`.

## Verification ladder

Climb only as far as the change requires.

- **`pixi run check`** — typecheck (core + editor) + unit tests + frontend lint. Fast; run it for every change.
  Any engine or server change needs a unit test alongside it (see `test/`).
- **Storybook** (`pixi run storybook`) — for isolated frontend component work, verify the
  component in isolation before wiring it into the canvas.
- **`pixi run e2e`** — Playwright, mock server + Vite. Slow; only for cross-cutting editor changes
  (deploy flow, canvas interactions) that unit tests can't cover.

## Safety invariant

The server actuates **nothing** unless a graph is deployed **live**. Just starting the server, and
the editor's preview, never change your home: sinks dry-run (log the intended call instead of
making it) until an explicit **Deploy** or enabled **auto-deploy**. Sinks also never actuate on a
non-`ok` value, so an offline input can't drive a call. `RW_DEPLOY_TOKEN`, when set, gates deploys.

## Module map

```
shared/engine/     pure evaluation shared by editor + server (evaluate.ts + one NodeDef per node)
shared/collab.ts   the Yjs editor-document model (flows, macros, settings)
src/server/        deployer (runtime.ts), feed (feed.ts, the WebSocket), security (connection-policy.ts)
src/ha/            Home Assistant clients — RealHA (live) and MockHA (in-memory, for tests/mock mode)
frontend/src/      the React Flow editor
```

## debugState — introspect a running server

The feed answers a `{"type":"debugState"}` client message with a snapshot: `deployed`,
`generation`, `mode` (`live`/`dry-run`), `autoDeploy`, `evaluatedAt`, `timestamp`, per-node
`health` + output `value`/`status`, and per-sink `desired` call / `status` / `inFlight`. The
message is read-only and not separately token-gated — but when `RW_DEPLOY_TOKEN` is set, the
connection handshake itself requires the token (see `connection-policy.ts`), so you must pass
`?token=<value>` on the WebSocket URL to connect at all. Query a running server:

```sh
node scripts/query-state.mjs   # RW_PORT/RW_DEPLOY_TOKEN honored
```

Or inline, with only the `ws` package:

```sh
node -e 'import("ws").then(({default:W})=>{const w=new W("ws://127.0.0.1:7420");w.on("open",()=>w.send(JSON.stringify({type:"debugState"})));w.on("message",m=>{const d=JSON.parse(m);if(d.type==="debugState"){console.log(JSON.stringify(d,null,2));w.close();}})})'
```

## Logging

Structured, single-line, stdout-only, no dependency (`src/server/log.ts`): ISO timestamp, level,
`[component]` tag, message, then `key=value` fields — greppable. `RW_LOG_LEVEL`
(`debug`|`info`|`warn`|`error`, default `info`) filters. Dry-run vs live actuation is a `mode`
field on the `deployer` component, not a message prefix.

## Repo mechanics

Version control is [jj](https://github.com/jj-vcs/jj), colocated with git — jj auto-snapshots the
working copy, so there is no staging step. The collaborative editor document persists to
`RW_DATA_DIR/editor-doc.ydoc` (default `.rw-data`, git-ignored); decode it with
`npx tsx scripts/decode-doc.mjs`.
