import type { ViewEdge } from "../../shared/engine/evaluate.js";
import { combineFlowGraphs, type RuntimeFlowGraph } from "../../shared/engine/flow-graphs.js";
import type { RuntimeMacroMap } from "../../shared/macros.js";
import type { NodeData } from "../../shared/node-types.js";
import type { CollabEdge, CollabNode, EditorDocumentSnapshot } from "../../shared/collab.js";
import { currentNodeTemplates, reconcileDefs } from "../../shared/engine/reconcile-defs.js";
import { sanitizeDeployRequest, type DeployRequest } from "./deploy-validation.js";
import { log } from "./log.js";
import { pinKey } from "../../shared/identity.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function nodeDefFromCollab(node: CollabNode): NodeData | null {
  const data = isRecord(node.data) ? node.data : null;
  const def = data && isRecord(data.def) ? data.def : null;
  if (!def || typeof def.id !== "string" || typeof def.type !== "string") return null;
  return def as unknown as NodeData;
}

export function edgeFromCollab(edge: CollabEdge, nodeIds: Set<string>): ViewEdge | null {
  if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null;
  return {
    id: edge.id,
    from: { node: edge.source, pin: edge.sourceHandle ?? "" },
    to: { node: edge.target, pin: edge.targetHandle ?? "" },
  };
}

function graphFromCollabFlow(flow: EditorDocumentSnapshot["flows"][number]): RuntimeFlowGraph {
  const rawNodes = flow.nodes.map(nodeDefFromCollab).filter((n): n is NodeData => !!n);
  const nodeIds = new Set(rawNodes.map((n) => n.id));
  const edges = flow.edges.map((edge) => edgeFromCollab(edge, nodeIds)).filter((edge): edge is ViewEdge => !!edge);
  // Heal a persisted def to the code's current pin shapes as it is read, so a removed pin surfaces
  // as a ghost (kept while wired) and an added pin appears, rather than meeting the engine stale.
  const wired = new Set<string>();
  for (const edge of edges) {
    wired.add(pinKey(edge.from.node, edge.from.pin));
    wired.add(pinKey(edge.to.node, edge.to.pin));
  }
  const nodes = reconcileDefs(rawNodes, currentNodeTemplates(), {
    isWired: (nodeId, pinId) => wired.has(pinKey(nodeId, pinId)),
  });
  return { flowId: flow.id, nodes, edges };
}

function enabledFlowIds(snapshot: EditorDocumentSnapshot): string[] {
  const flowIds = new Set(snapshot.flows.map((f) => f.id));
  if (Array.isArray(snapshot.settings.deployedFlowIds)) return snapshot.settings.deployedFlowIds.filter((id) => flowIds.has(id));
  const legacy = snapshot.settings.deployFlowId;
  if (legacy && flowIds.has(legacy)) return [legacy];
  return snapshot.flows[0] ? [snapshot.flows[0].id] : [];
}

export function graphFromEditorSnapshot(snapshot: EditorDocumentSnapshot): DeployRequest {
  const byId = new Map(snapshot.flows.map((flow) => [flow.id, flow]));
  const runtimeFlows = enabledFlowIds(snapshot)
    .map((id) => byId.get(id))
    .filter((flow): flow is EditorDocumentSnapshot["flows"][number] => !!flow)
    .map(graphFromCollabFlow);
  return { ...combineFlowGraphs(runtimeFlows), macros: snapshot.macros };
}

export class AutoDeployController {
  private lastSignature = "";

  constructor(private readonly deploy: (graph: DeployRequest) => void) {}

  maybeDeploy(snapshot: EditorDocumentSnapshot): { ok: boolean; unsupported: string[]; error?: string } | void {
    if (!snapshot.settings.autoDeploy) {
      this.lastSignature = "";
      return;
    }
    const raw = graphFromEditorSnapshot(snapshot);
    // A collaborative snapshot can carry node defs the editor never fully populated (missing or
    // malformed input/output arrays). Pass them through the same gate the WebSocket deploy path
    // uses so a bad def is rejected here instead of throwing inside the engine's tick.
    const validated = sanitizeDeployRequest(raw);
    if (!validated.ok) {
      // Record the failed document's signature so a doc that stays invalid warns only once, not on
      // every subsequent editor change; a later valid or differently-invalid doc warns afresh.
      const signature = JSON.stringify({ flowIds: snapshot.settings.deployedFlowIds ?? [snapshot.settings.deployFlowId], invalid: raw });
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        log("warn", "auto-deploy", "skipping deploy of an invalid graph", { error: validated.error });
      }
      return { ok: false, unsupported: [], error: validated.error };
    }
    const graph = validated.graph;
    const signature = JSON.stringify({ flowIds: snapshot.settings.deployedFlowIds ?? [snapshot.settings.deployFlowId], nodes: graph.nodes, edges: graph.edges, macros: graph.macros ?? {} });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.deploy({ nodes: graph.nodes, edges: graph.edges, macros: (graph.macros ?? {}) as RuntimeMacroMap });
    return { ok: true, unsupported: [] };
  }
}
