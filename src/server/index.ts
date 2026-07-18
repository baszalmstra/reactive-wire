import "dotenv/config";
import { RealHA } from "../ha/real.js";
import { MockHA } from "../ha/mock.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { startFeed } from "./feed.js";
import { startSimulator } from "./sim.js";
import { Deployer } from "./runtime.js";
import { DurableMemoryStore } from "./durable-memory.js";
import { EditorDocumentStore } from "./doc-store.js";
import { AutoDeployController } from "./collab-deploy-adapter.js";
import { applyStartupDeploymentPolicy } from "./startup-policy.js";
import { log } from "./log.js";

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
const staticDir = process.env.RW_STATIC_DIR?.trim() || undefined;
const trustedIngress = /^(1|true|yes)$/i.test(process.env.RW_TRUSTED_INGRESS?.trim() ?? "");

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
    log("info", "ha", "connected to Home Assistant", { url });
  } catch (err) {
    log("error", "ha", "failed to connect to Home Assistant", { url, error: describeHaConnectError(err) });
    log("error", "ha", "unset HA_URL/HA_TOKEN to run in mock mode, or fix the Home Assistant URL/token and network route");
    process.exit(1);
  }
} else {
  const mock = new MockHA();
  stopSim = startSimulator(mock);
  ha = mock;
  log("info", "server", "no HA_URL/HA_TOKEN set — running in mock mode with simulated entities");
}

// Manual mode starts undeployed. Persisted auto-deploy is durable authorization, so an enabled
// document resumes its validated live graph during startup. Async data-source nodes fetch over HTTP
// using the platform fetch, driven by the deployer's poller after a graph is deployed.
const durableMemory = new DurableMemoryStore({ dataDir });
const deployer = new Deployer(ha, 1000, (url, { signal }) => fetch(url, { signal }), durableMemory);
const documentStore = new EditorDocumentStore({ dataDir });

const autoDeploy = new AutoDeployController((graph) => deployer.deploy(graph.nodes, graph.edges, true, graph.macros ?? {}));

const stopFeed = startFeed(ha, { port, host, allowedHosts, allowedOrigins, deployToken, staticDir, trustedIngress }, {
  onDeploy: (req) => {
    deployer.deploy(req.nodes, req.edges, true, req.macros ?? {});
    return { ok: true, unsupported: [] };
  },
  documentStore,
  onDocumentChange: (snapshot) => autoDeploy.maybeDeploy(snapshot),
  inspect: () => {
    const settings = documentStore.snapshot().settings;
    return { ...deployer.inspect(), autoDeploy: settings.autoDeploy, deployedFlowIds: settings.deployedFlowIds ?? [settings.deployFlowId].filter((id): id is string => !!id) };
  },
});

const startupDeployment = applyStartupDeploymentPolicy(documentStore.snapshot(), autoDeploy);

log("info", "server", "listening", { url: `ws://${host}:${port}` });
if (deployToken) log("info", "server", "deploy/control WebSocket requires RW_DEPLOY_TOKEN");
if (trustedIngress && !deployToken) log("info", "server", "trusting upstream ingress authentication for deploy/control WebSocket");
if (staticDir) log("info", "server", "serving editor frontend", { path: staticDir });
log("info", "server", "collaborative editor document persistence", { path: documentStore.filePath });
if (startupDeployment.kind === "manual") {
  log("info", "server", "manual deployment policy — no graph deployed at startup");
} else if (startupDeployment.kind === "resumed") {
  log("info", "server", "resumed live graph from persisted auto-deploy authorization");
} else {
  log("warn", "server", "persisted auto-deploy graph rejected — no graph deployed at startup", { error: startupDeployment.error });
}

const shutdown = () => {
  stopFeed();
  stopSim();
  deployer.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
