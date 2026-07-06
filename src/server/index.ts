import "dotenv/config";
import { RealHA } from "../ha/real.js";
import { MockHA } from "../ha/mock.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { startFeed } from "./feed.js";
import { startSimulator } from "./sim.js";
import { Deployer } from "./runtime.js";
import { EditorDocumentStore } from "./doc-store.js";
import { AutoDeployController } from "./collab-deploy-adapter.js";

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
const dataDir = process.env.RW_DATA_DIR?.trim() || ".rw-data";

let ha: HAClient & EntityFeed;
let stopSim = () => {};

function describeHaConnectError(err: unknown): string {
  if (err === 1) return "cannot connect to Home Assistant; check HA_URL is reachable from this process";
  if (err === 2) return "invalid Home Assistant token";
  if (err === 4) return "HA_URL is required";
  if (err === 5) return "browser HTTPS to Home Assistant HTTP is not allowed by the HA websocket client";
  return err instanceof Error ? err.message : String(err);
}

if (url && token) {
  try {
    ha = await RealHA.connect(url, token);
    console.log(`Connected to Home Assistant at ${url}.`);
  } catch (err) {
    console.error(`Failed to connect to Home Assistant at ${url}: ${describeHaConnectError(err)}.`);
    console.error("Unset HA_URL/HA_TOKEN to run in mock mode, or fix the Home Assistant URL/token and network route.");
    process.exit(1);
  }
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
const documentStore = new EditorDocumentStore({ dataDir });

const autoDeploy = new AutoDeployController((graph) => deployer.deploy(graph.nodes, graph.edges, true, graph.macros ?? {}));

const stopFeed = startFeed(ha, { port, host, allowedHosts, allowedOrigins, deployToken }, {
  onDeploy: (req) => {
    deployer.deploy(req.nodes, req.edges, true, req.macros ?? {});
    return { ok: true, unsupported: [] };
  },
  documentStore,
  onDocumentChange: (snapshot) => autoDeploy.maybeDeploy(snapshot),
});

autoDeploy.maybeDeploy(documentStore.snapshot());

console.log(`Reactive Wire running: live entity feed on ws://${host}:${port}.`);
if (deployToken) console.log("Deploy/control WebSocket requires RW_DEPLOY_TOKEN.");
console.log(`Collaborative editor document persistence: ${documentStore.filePath}.`);
console.log("No graph deployed yet. Build one in the editor and Deploy to actuate Home Assistant.");

const shutdown = () => {
  stopFeed();
  stopSim();
  deployer.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
