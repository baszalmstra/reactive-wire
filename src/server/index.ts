import "dotenv/config";
import { RealHA } from "../ha/real.js";
import { MockHA } from "../ha/mock.js";
import { type EntityFeed, type HAClient } from "../ha/client.js";
import { startFeed, type DeployRequest } from "./feed.js";
import { startSimulator } from "./sim.js";
import { Deployer } from "./runtime.js";
import { EditorDocumentStore } from "./doc-store.js";
import type { NodeData } from "../../shared/node-types.js";
import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { MacroMap } from "../../shared/macros.js";
import type { CollabEdge, CollabNode, EditorDocumentSnapshot } from "../../shared/collab.js";

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nodeDefFromCollab(node: CollabNode): NodeData | null {
  const data = isRecord(node.data) ? node.data : null;
  const def = data && isRecord(data.def) ? data.def : null;
  if (!def || typeof def.id !== "string" || typeof def.type !== "string") return null;
  return def as unknown as NodeData;
}

function edgeFromCollab(edge: CollabEdge, nodeIds: Set<string>): ViewEdge | null {
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null;
  return {
    id: edge.id,
    from: { node: edge.source, pin: edge.sourceHandle ?? "" },
    to: { node: edge.target, pin: edge.targetHandle ?? "" },
  };
}

function graphFromSnapshot(snapshot: EditorDocumentSnapshot): DeployRequest | null {
  const deployFlowId = snapshot.settings.deployFlowId;
  const flow = snapshot.flows.find((f) => f.id === deployFlowId) ?? snapshot.flows[0];
  if (!flow) return null;
  const nodes = flow.nodes.map(nodeDefFromCollab).filter((n): n is NodeData => !!n);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = flow.edges.map((edge) => edgeFromCollab(edge, nodeIds)).filter((edge): edge is ViewEdge => !!edge);
  return { nodes, edges, macros: snapshot.macros };
}

let lastAutoDeploySignature = "";
function maybeAutoDeploy(snapshot: EditorDocumentSnapshot): { ok: boolean; unsupported: string[]; error?: string } | void {
  if (!snapshot.settings.autoDeploy) {
    lastAutoDeploySignature = "";
    return;
  }
  const graph = graphFromSnapshot(snapshot);
  if (!graph) return { ok: false, unsupported: [], error: "No flow is available to auto-deploy" };
  const signature = JSON.stringify({ flowId: snapshot.settings.deployFlowId, nodes: graph.nodes, edges: graph.edges, macros: graph.macros ?? {} });
  if (signature === lastAutoDeploySignature) return;
  lastAutoDeploySignature = signature;
  deployer.deploy(graph.nodes as unknown as NodeData[], graph.edges as unknown as ViewEdge[], true, (graph.macros ?? {}) as unknown as MacroMap);
  return { ok: true, unsupported: [] };
}

const stopFeed = startFeed(ha, { port, host, allowedHosts, allowedOrigins, deployToken }, {
  onDeploy: (req) => {
    deployer.deploy(req.nodes as unknown as NodeData[], req.edges as unknown as ViewEdge[], true, (req.macros ?? {}) as unknown as MacroMap);
    return { ok: true, unsupported: [] };
  },
  documentStore,
  onDocumentChange: maybeAutoDeploy,
});

maybeAutoDeploy(documentStore.snapshot());

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
