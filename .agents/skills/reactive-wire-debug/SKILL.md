---
name: reactive-wire-debug
description: Inspect a running Reactive Wire server, diagnose deployed graph state and sink behavior, or decode the persisted editor document.
---

# Debug Reactive Wire

Use this skill when diagnosing why a deployed graph does or does not actuate, why a node is
unavailable or errored, what the server currently has deployed, or what is stored in the editor
document.

## Start an isolated mock server

With `HA_URL` and `HA_TOKEN` unset, the server uses the built-in mock Home Assistant client and
simulator. Use a scratch data directory so existing editor state and auto-deploy settings cannot
interfere.

```sh
# bash / Linux
RW_DATA_DIR=$(mktemp -d) pixi run start
```

```powershell
# PowerShell / Windows
$env:RW_DATA_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP (New-Guid))).FullName
pixi run start
```

The feed listens on `ws://127.0.0.1:7420` by default. A new document starts with no deployed graph;
deploy from the editor (`pixi run fe-dev`) or enable auto-deploy before expecting actuation.
Persisted `autoDeploy: true` is durable authorization: the server validates and resumes enabled
flows at startup.

## Query runtime state

The feed answers a read-only `{"type":"debugState"}` message. When `RW_DEPLOY_TOKEN` is set, the
WebSocket handshake still requires the token. The bundled script reads `RW_HOST`, `RW_PORT`, and
`RW_DEPLOY_TOKEN`:

```sh
pixi run npx --no-install tsx scripts/query-state.ts
```

Read the response as follows:

- **`deployed` / `generation`** — whether a graph is running and how many times it has been deployed
  or stopped.
- **`mode`** — `live` lets sinks actuate; `dry-run` only logs. Unexpected `dry-run` generally means
  the graph was not deployed live or auto-deploy is off.
- **`autoDeploy`** — the server-owned document setting.
- **`evaluatedAt` / `timestamp`** — epoch milliseconds for the last recompute and the response.
- **`nodes[id].health`** — `ok`, `warn`, or `error`. `warn` means at least one pin is unavailable or
  stale; `error` means an input/output errored or an output pin is no longer defined.
- **`nodes[id].outputs[pin]`** — `{ type, status, value, msg? }`; status is `ok`, `unavailable`,
  `error`, or `stale`. The safety rule blocks sink actuation when an upstream status is not `ok`.
- **`sinks[id]`** — `desired` is the current service call or `null`; `status` and `note` explain a
  hold; `inFlight` shows an awaiting call; `lastCommand` records the generic call-service sink's
  remembered command.

## Decode the persisted editor document

The Yjs document containing flows, macros, and settings is stored at
`RW_DATA_DIR/editor-doc.ydoc`. `RW_DOC_FILE` can override the exact path.

```sh
# bash / Linux
RW_DATA_DIR=.rw-data pixi run npx --no-install tsx scripts/decode-doc.ts
```

```powershell
# PowerShell / Windows
$env:RW_DATA_DIR = ".rw-data"
pixi run npx --no-install tsx scripts/decode-doc.ts
```

The script prints flow node/edge counts, settings, macro count, and the full snapshot. Confirm
`autoDeploy` and `deployedFlowIds` when investigating startup behavior; `deployFlowId` exists only
for legacy documents.
