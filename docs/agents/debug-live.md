# Debugging a live server

Inspect a running Reactive Wire server: start it in mock mode, query live runtime state over the
WebSocket feed (`debugState`), read node health/status, and decode the persisted editor document.
Use this when diagnosing why a deployed graph does or does not actuate, why a node reads
unavailable/error, or what the server currently has deployed.

## Start the server (no Home Assistant needed)

With `HA_URL`/`HA_TOKEN` unset the server runs a mock HA plus a simulator, so nothing external is
required. Point `RW_DATA_DIR` at a scratch dir to keep a clean document:

```sh
# bash / Linux
RW_DATA_DIR=$(mktemp -d) pixi run start     # feed on ws://127.0.0.1:7420
```
```powershell
# PowerShell (Windows)
$env:RW_DATA_DIR = (New-Item -ItemType Directory -Path (Join-Path $env:TEMP (New-Guid))).FullName; pixi run start
```

Deploy a graph from the editor (`pixi run fe-dev`, then Deploy) — or enable auto-deploy — before
expecting any actuation. The server starts with no graph deployed.

## Query runtime state (debugState)

The feed answers a read-only `{"type":"debugState"}` message. The message itself is not separately
token-gated, but the connection handshake is: when `RW_DEPLOY_TOKEN` is set you must pass
`?token=<value>` on the WebSocket URL to connect at all (the bundled script does this from
`RW_DEPLOY_TOKEN`). Use the bundled script:

```sh
node scripts/query-state.mjs    # honors RW_HOST/RW_PORT/RW_DEPLOY_TOKEN
```

### Reading the snapshot

- **`deployed` / `generation`** — whether a graph is running and how many times it has been
  (re)deployed. `generation` bumps on every deploy and on stop.
- **`mode`** — `live` (sinks actuate) or `dry-run` (sinks only log). If you expected actuation and
  see `dry-run`, the graph was never deployed live / auto-deploy is off.
- **`autoDeploy`** — the server-owned document setting.
- **`evaluatedAt` / `timestamp`** — epoch ms of the last recompute, and of this response.
- **`nodes[id].health`** — `ok` / `warn` / `error`. `warn` means some pin is `unavailable` or
  `stale`; `error` means a pin errored or a required entity is missing.
- **`nodes[id].outputs[pin]`** — `{ type, status, value, msg? }`. `status` is
  `ok`/`unavailable`/`error`/`stale`. A sink that isn't firing usually traces back to an upstream
  output whose `status` is not `ok` — the safety rule blocks actuation on non-`ok` values.
- **`sinks[id]`** — `desired` is the service call the sink wants right now (or `null` when it
  holds), `status`/`note` explain a hold (e.g. `no entity set`, `<pin> = unavailable — no call`),
  `inFlight` is true while a call awaits a response, `lastCommand` is the remembered command for a
  generic call-service sink.

## Decode the persisted editor document

The saved Yjs document (flows, macros, settings) lives at `RW_DATA_DIR/editor-doc.ydoc`. It imports
a shared TypeScript helper, so run it through tsx:

```sh
# bash / Linux
RW_DATA_DIR=.rw-data npx tsx scripts/decode-doc.mjs
```
```powershell
# PowerShell (Windows)
$env:RW_DATA_DIR = ".rw-data"; npx tsx scripts/decode-doc.mjs
```

It prints a compact overview (per-flow node/edge counts, settings, macro count) plus the full
snapshot. Use it to confirm what graph the server would auto-deploy and whether `autoDeploy` /
`deployFlowId` are set as expected.
