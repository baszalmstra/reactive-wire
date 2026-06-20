import "dotenv/config";
import { RealHA } from "../ha/real.js";
import { MockHA } from "../ha/mock.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { startFeed } from "./feed.js";
import { startSimulator } from "./sim.js";
import { Deployer } from "./runtime.js";
import type { NodeData } from "../../shared/node-types.js";
import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { MacroMap } from "../../shared/macros.js";

const url = process.env.HA_URL;
const token = process.env.HA_TOKEN;
const port = Number(process.env.RW_PORT ?? 7420);
const host = process.env.RW_HOST?.trim() || "127.0.0.1";
const deployToken = process.env.RW_DEPLOY_TOKEN?.trim() || undefined;
const listEnv = (name: string): string[] | undefined => {
  const raw = process.env[name];
  if (!raw) return undefined;
  const values = raw.split(",").map((x) => x.trim()).filter(Boolean);
  return values.length ? values : undefined;
};
const allowedHosts = listEnv("RW_ALLOWED_HOSTS");
const allowedOrigins = listEnv("RW_ALLOWED_ORIGINS");

let ha: HAClient & EntityFeed;
let stopSim = () => {};

if (url && token) {
  ha = await RealHA.connect(url, token);
  console.log(`Connected to Home Assistant at ${url}.`);
} else {
  const mock = new MockHA();
  stopSim = startSimulator(mock);
  ha = mock;
  console.log("No HA_URL/HA_TOKEN set — running in mock mode with simulated entities.");
}

// No graph runs until the editor deploys one. Sinks actuate only on deploy (an explicit act),
// so just launching the server can't change anything. Async data-source nodes fetch over HTTP
// using the platform fetch, driven by the deployer's poller after a graph is deployed.
const deployer = new Deployer(ha, 1000, (url) => fetch(url));

const stopFeed = startFeed(ha, { port, host, allowedHosts, allowedOrigins, deployToken }, {
  onDeploy: (req) => {
    deployer.deploy(req.nodes as unknown as NodeData[], req.edges as unknown as ViewEdge[], true, (req.macros ?? {}) as unknown as MacroMap);
    return { ok: true, unsupported: [] };
  },
});

console.log(`Reactive Wire running: live entity feed on ws://${host}:${port}.`);
if (deployToken) console.log("Deploy/control WebSocket requires RW_DEPLOY_TOKEN.");
console.log("No graph deployed yet. Build one in the editor and Deploy to actuate Home Assistant.");

const shutdown = () => {
  stopFeed();
  stopSim();
  deployer.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
