import type { NodeData } from "../node-types.js";
import type { ViewEdge } from "./evaluate.js";
import { joinPath } from "./expand.js";

export interface RuntimeFlowGraph {
  flowId: string;
  nodes: NodeData[];
  edges: ViewEdge[];
}

export interface RuntimeGraph {
  nodes: NodeData[];
  edges: ViewEdge[];
}

/** The runtime node id for a node that belongs to one editor flow. */
export function flowRuntimeNodeId(flowId: string, nodeId: string): string {
  return joinPath(joinPath("", flowId), nodeId);
}

/**
 * Prefix every node/edge id in an editor flow before combining flows into one runtime graph.
 * That keeps separate flow tabs from sharing node ids, memory slots, or sink bookkeeping.
 */
export function namespaceFlowGraph(flow: RuntimeFlowGraph): RuntimeGraph {
  const local = (id: string) => flowRuntimeNodeId(flow.flowId, id);
  return {
    nodes: flow.nodes.map((node) => ({ ...node, id: local(node.id) })),
    edges: flow.edges.map((edge) => ({
      id: local(edge.id),
      from: { node: local(edge.from.node), pin: edge.from.pin },
      to: { node: local(edge.to.node), pin: edge.to.pin },
    })),
  };
}

/** Combine all enabled editor flows into the single flat graph the existing runtime deploys. */
export function combineFlowGraphs(flows: RuntimeFlowGraph[]): RuntimeGraph {
  const nodes: NodeData[] = [];
  const edges: ViewEdge[] = [];
  for (const flow of flows) {
    const namespaced = namespaceFlowGraph(flow);
    nodes.push(...namespaced.nodes);
    edges.push(...namespaced.edges);
  }
  return { nodes, edges };
}
