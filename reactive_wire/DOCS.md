# Reactive Wire add-on

Reactive Wire runs the existing Node backend inside Home Assistant and serves the editor through Supervisor Ingress. No long-lived Home Assistant token is required: the add-on uses the Supervisor-provided Home Assistant API token.

## First start

1. Install and start the add-on.
2. Open **Reactive Wire** from the Home Assistant sidebar.
3. Build or edit a graph.
4. Press **Deploy** when you want sinks to actuate Home Assistant.

The editor document is stored in `/data/editor-doc.ydoc`, so it is included in add-on backups. The server starts with no graph deployed after a fresh install; previewing the editor does not call Home Assistant services.

## Options

- `log_level`: structured stdout log verbosity (`debug`, `info`, `warn`, or `error`).

## Network and auth

The add-on exposes no host port by default. Browser access goes through Supervisor Ingress, and backend Home Assistant access goes through `ws://supervisor/core/websocket` using `SUPERVISOR_TOKEN`.
