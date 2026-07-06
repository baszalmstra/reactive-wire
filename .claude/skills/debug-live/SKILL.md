---
name: debug-live
description: Inspect a running Reactive Wire server — start it in mock mode, query live runtime state over the WebSocket feed (debugState), read node health/status, and decode the persisted editor document. Use when diagnosing why a deployed graph does or does not actuate, why a node reads unavailable/error, or what the server currently has deployed.
---

Follow the agent-neutral guide at [docs/agents/debug-live.md](../../../docs/agents/debug-live.md).

Quick reference: `RW_DATA_DIR=<scratch> pixi run start` boots a mock-mode server on
`ws://127.0.0.1:7420`; `node scripts/query-state.mjs` queries its `debugState` snapshot;
`npx tsx scripts/decode-doc.mjs` decodes the persisted editor document. The guide explains how to
read health/status fields and trace a sink that is not firing.
