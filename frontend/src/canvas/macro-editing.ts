import type { Edge } from "@xyflow/react";
import type { NodeData, PinDef } from "../../../shared/node-types.js";
import {
  isMacroInstance,
  macroHasMemory,
  MACRO_IN,
  MACRO_OUT,
  type MacroDef,
  type MacroMap,
} from "../../../shared/macros.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";
import type { RWNodeType } from "./validation.js";

/** Convert a stored macro definition into React Flow nodes and edges for editing. */
export function macroDefToFlow(def: MacroDef): { nodes: RWNodeType[]; edges: Edge[] } {
  const nodes = def.nodes.map((n) => ({
    id: n.id,
    type: "rw" as const,
    position: { x: n.x, y: n.y },
    dragHandle: ".rw-drag",
    data: { def: n },
  }));
  const edges = def.edges.map((e) => ({
    id: e.id,
    source: e.from.node,
    sourceHandle: e.from.pin,
    target: e.to.node,
    targetHandle: e.to.pin,
    animated: true,
  }));
  return { nodes, edges };
}

/** Read a macro's public interface from its boundary nodes. */
export function macroBoundaryPins(nodes: NodeData[]): { inputs: PinDef[]; outputs: PinDef[] } {
  const inputs: PinDef[] = [];
  const outputs: PinDef[] = [];
  for (const n of nodes) {
    if (n.type === MACRO_IN) for (const p of n.outputs) inputs.push({ ...p });
    if (n.type === MACRO_OUT) for (const p of n.inputs) outputs.push({ ...p });
  }
  return { inputs, outputs };
}

export function viewEdgesFromReactFlow(edges: Edge[]): ViewEdge[] {
  return edges.map((e) => ({
    id: e.id,
    from: { node: e.source, pin: e.sourceHandle ?? "" },
    to: { node: e.target, pin: e.targetHandle ?? "" },
  }));
}

export function liveNodesFromReactFlow(nodes: RWNodeType[]): NodeData[] {
  return nodes.map((n) => ({ ...n.data.def, x: n.position.x, y: n.position.y }));
}

/** Save a macro definition from the edited graph, deriving its interface from boundary nodes. */
export function macroDefFromFlow({
  original,
  name,
  nodes,
  edges,
  macros,
}: {
  original: MacroDef;
  name: string;
  nodes: RWNodeType[];
  edges: Edge[];
  macros: MacroMap;
}): MacroDef {
  const liveNodes = liveNodesFromReactFlow(nodes);
  const liveEdges = viewEdgesFromReactFlow(edges);
  const { inputs, outputs } = macroBoundaryPins(liveNodes);
  const updated: MacroDef = {
    ...original,
    name: name.trim() || original.name,
    nodes: liveNodes,
    edges: liveEdges,
    inputs,
    outputs,
    stateful: false,
  };
  updated.stateful = macroHasMemory(updated, { ...macros, [updated.id]: updated });
  return updated;
}

/** Bring a placement's pins, title and memory flag back in line with its definition. */
export function syncMacroInstance(node: NodeData, macros: MacroMap): NodeData {
  if (!isMacroInstance(node.type)) return node;
  const def = macros[String(node.config?.macroId ?? "")];
  if (!def) return node;
  return {
    ...node,
    title: def.name,
    stateful: macroHasMemory(def, macros),
    inputs: def.inputs.map((p) => ({ ...p, editable: true })),
    outputs: def.outputs.map((p) => ({ ...p })),
  };
}

export function syncMacroInstances(nodes: RWNodeType[], macros: MacroMap): RWNodeType[] {
  return nodes.map((n) => ({ ...n, data: { def: syncMacroInstance(n.data.def, macros) } }));
}
