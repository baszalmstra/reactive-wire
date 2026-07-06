#!/usr/bin/env node
// Connect to a running Reactive Wire server, request a one-shot debugState snapshot, pretty-print
// it, and exit. Reads RW_HOST (default 127.0.0.1), RW_PORT (default 7420), and RW_DEPLOY_TOKEN
// (sent as the connection token when set). Only depends on the `ws` package, so plain `node` runs
// it. Usage: node query-state.mjs
import WebSocket from "ws";

const host = process.env.RW_HOST?.trim() || "127.0.0.1";
const port = Number(process.env.RW_PORT ?? 7420);
const token = process.env.RW_DEPLOY_TOKEN?.trim();
const url = `ws://${host}:${port}/${token ? `?token=${encodeURIComponent(token)}` : ""}`;

const ws = new WebSocket(url, { headers: { origin: "http://localhost:5173" } });
const timer = setTimeout(() => {
  console.error("Timed out waiting for a debugState response.");
  process.exit(1);
}, 5000);

ws.on("open", () => ws.send(JSON.stringify({ type: "debugState" })));
ws.on("message", (raw) => {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  // The server also pushes `entities` and `docState` frames on connect; wait for our answer.
  if (msg.type !== "debugState") return;
  clearTimeout(timer);
  console.log(JSON.stringify(msg, null, 2));
  ws.close();
  process.exit(0);
});
ws.on("error", (err) => {
  console.error(`Connection to ${url} failed: ${err.message}`);
  process.exit(1);
});
