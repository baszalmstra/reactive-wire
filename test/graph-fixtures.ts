import { evaluate, type Memory, type SourceMap, type ViewEdge } from "../shared/engine/evaluate.js";
import type { EntityMap } from "../shared/entities.js";
import type { NodeData, PinDef } from "../shared/node-types.js";
import type { ValueType } from "../shared/theme.js";
import type { EvalResults } from "../shared/results.js";

export function pin(id: string, type: ValueType, patch: Partial<PinDef> = {}): PinDef {
  return { id, label: id, type, ...patch };
}

export function graphNode(patch: Partial<NodeData> & Pick<NodeData, "id" | "type">): NodeData {
  return {
    title: patch.type,
    subtitle: "",
    icon: "const",
    x: 0,
    y: 0,
    inputs: [],
    outputs: [],
    ...patch,
  };
}

export function constNode(id: string, type: ValueType, value: unknown, out = "out"): NodeData {
  const constType = type === "bool" ? "const-bool" : type === "num" ? "const-number" : type === "color" ? "const-color" : "const-string";
  return graphNode({
    id,
    type: constType,
    values: { [out]: value },
    outputs: [pin(out, type, { editable: true })],
  });
}

export function entityNode(id: string, entity_id: string, outputs: PinDef[]): NodeData {
  return graphNode({
    id,
    type: "entity",
    icon: "ha",
    config: { entity_id },
    outputs,
  });
}

export function wire(id: string, from: string, fromPin: string, to: string, toPin: string): ViewEdge {
  return { id, from: { node: from, pin: fromPin }, to: { node: to, pin: toPin } };
}

export function runGraph({
  nodes,
  edges = [],
  entities = {},
  memory = {} as Memory,
  now = 0,
  sources = {},
}: {
  nodes: NodeData[];
  edges?: ViewEdge[];
  entities?: EntityMap;
  memory?: Memory;
  now?: number;
  sources?: SourceMap;
}): EvalResults {
  return evaluate(nodes, edges, entities, memory, now, sources);
}
