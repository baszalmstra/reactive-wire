import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { MacroMap } from "../../shared/macros.js";
import type { NodeData } from "../../shared/node-types.js";
import type { CollabEdge, CollabNode, EditorDocumentSnapshot } from "../../shared/collab.js";
import type { DeployRequest } from "./deploy-validation.js";

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

export function graphFromEditorSnapshot(snapshot: EditorDocumentSnapshot): DeployRequest | null {
  const deployFlowId = snapshot.settings.deployFlowId;
  const flow = snapshot.flows.find((f) => f.id === deployFlowId) ?? snapshot.flows[0];
  if (!flow) return null;
  const nodes = flow.nodes.map(nodeDefFromCollab).filter((n): n is NodeData => !!n);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = flow.edges.map((edge) => edgeFromCollab(edge, nodeIds)).filter((edge): edge is ViewEdge => !!edge);
  return { nodes, edges, macros: snapshot.macros };
}

export class AutoDeployController {
  private lastSignature = "";

  constructor(private readonly deploy: (graph: DeployRequest) => void) {}

  maybeDeploy(snapshot: EditorDocumentSnapshot): { ok: boolean; unsupported: string[]; error?: string } | void {
    if (!snapshot.settings.autoDeploy) {
      this.lastSignature = "";
      return;
    }
    const graph = graphFromEditorSnapshot(snapshot);
    if (!graph) return { ok: false, unsupported: [], error: "No flow is available to auto-deploy" };
    const signature = JSON.stringify({ flowId: snapshot.settings.deployFlowId, nodes: graph.nodes, edges: graph.edges, macros: graph.macros ?? {} });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.deploy({ nodes: graph.nodes, edges: graph.edges, macros: (graph.macros ?? {}) as MacroMap });
    return { ok: true, unsupported: [] };
  }
}
