# Reactive Wire

A node-based **reactive** automation system for Home Assistant. Instead of scripting
transitions, you wire a typed graph where an entity's desired state is *derived* from the
combined current state of other entities. Any input change re-derives the output.

See [DESIGN.md](./DESIGN.md) for the full design and rationale.

## Status

Works end to end: build a typed reactive graph in the editor, point nodes at your real
entities, and deploy it to a server that actuates Home Assistant live.

- **One engine** (`shared/engine/evaluate.ts`) powers both the editor's live preview and
  the server's actuation. Every value is `ok` / `unavailable` / `error`, propagating with
  Kleene 3-valued logic so an offline sensor never silently reads `false` and actuates wrong.
- **Reconciling sinks** call a service only when actual state differs from desired state, and
  never on a non-`Ok` value (safety).
- **Editor** (React Flow): drag nodes from a palette, connect typed pins (type + cycle
  validated), edit values inline, autocomplete real entities, live values on every pin.
- **Server**: long-lived-token HA WebSocket — streams a live entity feed and actuates on
  deploy (dry-run preview by default). In-memory mock + simulator when no HA is configured.
- **Editable pin values**: input defaults, constants, and compare operands via one mechanism.

See [DESIGN.md §9](./DESIGN.md) for the roadmap.

## Prerequisites

[pixi](https://pixi.sh) manages the Node toolchain and every task — core and editor.
From the project root:

```sh
pixi run install-all     # install core + editor dependencies (cached; re-runs only on manifest/lockfile change)
```

## Commands

Everything runs through pixi. Core (engine + server):

```sh
pixi run test            # run the engine/unit test suite
pixi run typecheck       # type-check the core
pixi run start           # run the server against a live Home Assistant
pixi run check           # typecheck core + editor and run the tests
```

Editor frontend (run in ./frontend automatically; auto-installs if needed):

```sh
pixi run storybook       # explore the component library
pixi run build-storybook # static Storybook build
pixi run fe-typecheck    # type-check the editor
pixi run fe-dev          # Vite dev server
```

## Running against Home Assistant

Copy `.env.example` to `.env` and fill in your instance URL and a long-lived access token:

```sh
cp .env.example .env
# edit .env: HA_URL, HA_TOKEN
pixi run start
```

The server loads `.env` automatically. By default the editor feed/deploy WebSocket binds to
`127.0.0.1:7420`, validates loopback browser origins, and is not exposed to your LAN. If you
intentionally bind it elsewhere with `RW_HOST`, also set explicit `RW_ALLOWED_HOSTS` /
`RW_ALLOWED_ORIGINS` and strongly consider `RW_DEPLOY_TOKEN`; start the editor with the same
value exported as `VITE_RW_DEPLOY_TOKEN` (or put it in `frontend/.env.local`) so it can connect
and deploy.

Inline environment variables still work and take precedence over `.env`:

```sh
HA_URL=http://homeassistant.local:8123 HA_TOKEN=<token> pixi run start
```

Without `HA_URL`/`HA_TOKEN`, the server runs in **mock mode** with simulated entities, so the
editor works as a demo with no Home Assistant. The server starts with **no graph deployed** —
build one in the editor and Deploy it (persistent save/load is on the roadmap, §9).

**Safety:** just running the server (and the editor's live preview) **never changes your
home** — the auto-started demo graph runs in dry-run. Sinks actuate only when you **Deploy**
(or enable **auto-deploy**) from the editor, which is an explicit, intentional act.

## Connecting the editor to live Home Assistant

Run the server and the editor together:

```sh
pixi run start     # server: connects to HA (or mock), serves a live entity feed on ws://127.0.0.1:7420
pixi run fe-dev    # editor: http://localhost:5173
```

The editor connects to the feed automatically. When connected it shows **LIVE** and its
entity nodes reflect your real Home Assistant state; with no server it shows **DEMO** and runs
a built-in simulation. The example reads `sun.sun`, `binary_sensor.room_presence`, and
`light.bedroom` — entities you don't have simply read as unavailable.

### Editing and deploying

In the editor you can drag pins to **connect** (invalid types and cycles are refused),
**select**/**delete**, drag nodes, and edit a selected node's config in the **inspector** —
including pointing an entity node at any of your real `entity_id`s. Edits update the live
preview immediately.

Press **Deploy** (or tick **auto-deploy**) to send the graph to the server and run it **live**
against Home Assistant; sinks show as live in the editor. Editing returns the graph to a draft
(sinks dry-run) until the next deploy.

## Layout

```
shared/               neutral engine + types, imported by both editor and server
  engine/evaluate.ts   the single reactive engine (dispatcher)
  engine/nodes/        one self-contained NodeDef per node type (registry)
  value.ts results.ts node-types.ts entities.ts theme.ts macros.ts   shared model
src/                  server + Home Assistant adapters
  ha/                 HAClient/EntityFeed, MockHA, RealHA (subscribeEntities + callService)
  server/             index (boot), feed (WebSocket), runtime (Deployer), sim
  reactive.ts         cell (live entity storage for the HA layer)
frontend/             the editor (Vite + React + Tailwind v4 + React Flow)
  src/canvas/         React Flow node, validation, palette, inspector, entity picker, popups
  src/components/     ValueChip, Pin, Widgets (value editors), Badges, Icon, NodeView
  src/canvas/node-templates.ts   registry-derived palette catalog
test/                 engine, stateful, time, variadic, fetch, sinks, macros, poller tests
```
