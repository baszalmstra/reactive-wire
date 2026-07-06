import type { ViewEdge } from "../../shared/engine/evaluate.js";
import type { MacroMap } from "../../shared/macros.js";
import type { NodeData } from "../../shared/node-types.js";
import type { CollabEdge, CollabNode, EditorDocumentSnapshot } from "../../shared/collab.js";
import { sanitizeDeployRequest, type DeployRequest } from "./deploy-validation.js";
import { log } from "./log.js";

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
    const raw = graphFromEditorSnapshot(snapshot);
    if (!raw) return { ok: false, unsupported: [], error: "No flow is available to auto-deploy" };
    // A collaborative snapshot can carry node defs the editor never fully populated (missing or
    // malformed input/output arrays). Pass them through the same gate the WebSocket deploy path
    // uses so a bad def is rejected here instead of throwing inside the engine's tick.
    const validated = sanitizeDeployRequest(raw);
    if (!validated.ok) {
      // Record the failed document's signature so a doc that stays invalid warns only once, not on
      // every subsequent editor change; a later valid or differently-invalid doc warns afresh.
      const signature = JSON.stringify({ flowId: snapshot.settings.deployFlowId, invalid: raw });
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        log("warn", "auto-deploy", "skipping deploy of an invalid graph", { error: validated.error });
      }
      return { ok: false, unsupported: [], error: validated.error };
    }
    const graph = validated.graph;
    const signature = JSON.stringify({ flowId: snapshot.settings.deployFlowId, nodes: graph.nodes, edges: graph.edges, macros: graph.macros ?? {} });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.deploy({ nodes: graph.nodes, edges: graph.edges, macros: (graph.macros ?? {}) as MacroMap });
    return { ok: true, unsupported: [] };
  }
}
