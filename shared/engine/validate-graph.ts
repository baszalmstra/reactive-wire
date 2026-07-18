import type { RuntimeMacroMap } from "../macros.js";
import type { RuntimeNode, RuntimePin, ValueType } from "../runtime-types.js";
import { ownValue } from "../record.js";
import { pinKey } from "../identity.js";
import type { ViewEdge } from "./evaluate.js";
import { REGISTRY } from "./nodes/index.js";

export interface GraphSemanticError {
  code:
    | "unknown-node-type"
    | "unknown-macro"
    | "recursive-macro"
    | "invalid-node-shape"
    | "invalid-pin"
    | "invalid-edge"
    | "duplicate-input-source"
    | "type-mismatch"
    | "cycle";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export type GraphSemanticValidation =
  | { ok: true }
  | { ok: false; error: GraphSemanticError };

/** Exact type equality, except that an unresolved generic `any` endpoint accepts either side. */
export function typesCompatible(a: ValueType | undefined, b: ValueType | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a === "any" || b === "any";
}

/** Whether adding source -> target to a directed edge list would create a node-level cycle. */
export function wouldCreateCycle(
  edges: Iterable<{ source: string; target: string }>,
  source: string,
  target: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoing = adjacency.get(edge.source) ?? [];
    outgoing.push(edge.target);
    adjacency.set(edge.source, outgoing);
  }
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const nodeId = stack.pop()!;
    if (nodeId === source) return true;
    for (const next of adjacency.get(nodeId) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

function error(value: GraphSemanticError): GraphSemanticValidation {
  return { ok: false, error: value };
}

function pinMap(pins: RuntimePin[], nodeId: string, side: "input" | "output"): Map<string, RuntimePin> | GraphSemanticValidation {
  const out = new Map<string, RuntimePin>();
  for (const pin of pins) {
    if (out.has(pin.id)) {
      return error({ code: "invalid-pin", nodeId, message: `Node ${JSON.stringify(nodeId)} has duplicate ${side} pin ${JSON.stringify(pin.id)}` });
    }
    if (pin.ghost) {
      return error({ code: "invalid-pin", nodeId, message: `Node ${JSON.stringify(nodeId)} has unresolved ghost pin ${JSON.stringify(pin.id)}` });
    }
    out.set(pin.id, pin);
  }
  return out;
}

function isValidation(value: Map<string, RuntimePin> | GraphSemanticValidation): value is GraphSemanticValidation {
  return "ok" in value;
}

function expectedPinMap(pins: RuntimePin[]): Map<string, RuntimePin> {
  return new Map(pins.map((pin) => [pin.id, pin]));
}

function validateRequiredPins(
  node: RuntimeNode,
  actual: Map<string, RuntimePin>,
  expected: Map<string, RuntimePin>,
  side: "input" | "output",
  allowExtra: (pin: RuntimePin) => boolean,
): GraphSemanticValidation {
  for (const [pinId, wanted] of expected) {
    const got = actual.get(pinId);
    if (!got) {
      if (wanted.variadic) continue;
      return error({ code: "invalid-node-shape", nodeId: node.id, message: `Node ${JSON.stringify(node.id)} is missing ${side} pin ${JSON.stringify(pinId)}` });
    }
    if (got.type !== wanted.type) {
      return error({ code: "invalid-pin", nodeId: node.id, message: `Node ${JSON.stringify(node.id)} ${side} pin ${JSON.stringify(pinId)} must be ${wanted.type}, not ${got.type}` });
    }
  }
  for (const pin of actual.values()) {
    if (!expected.has(pin.id) && !allowExtra(pin)) {
      return error({ code: "invalid-node-shape", nodeId: node.id, message: `Node ${JSON.stringify(node.id)} has unexpected ${side} pin ${JSON.stringify(pin.id)}` });
    }
  }
  return { ok: true };
}

function validateNodeShape(node: RuntimeNode): GraphSemanticValidation {
  const def = ownValue(REGISTRY, node.type);
  if (!def) return error({ code: "unknown-node-type", nodeId: node.id, message: `Unknown node type ${JSON.stringify(node.type)}` });
  const inputs = pinMap(node.inputs, node.id, "input");
  if (isValidation(inputs)) return inputs;
  const outputs = pinMap(node.outputs, node.id, "output");
  if (isValidation(outputs)) return outputs;

  if (node.type === "entity") {
    if (inputs.size) return error({ code: "invalid-node-shape", nodeId: node.id, message: `Entity node ${JSON.stringify(node.id)} cannot have inputs` });
    return { ok: true };
  }

  if (node.type === "sink-light") {
    const allowed = new Map<string, ValueType>([
      ["on", "bool"],
      ["color", "color"],
      ["temperature", "num"],
      ["brightness", "num"],
    ]);
    if (outputs.size) return error({ code: "invalid-node-shape", nodeId: node.id, message: `Light sink ${JSON.stringify(node.id)} cannot have outputs` });
    for (const pin of inputs.values()) {
      if (allowed.get(pin.id) !== pin.type) {
        return error({ code: "invalid-pin", nodeId: node.id, message: `Light sink ${JSON.stringify(node.id)} has invalid pin ${JSON.stringify(pin.id)}` });
      }
    }
    const on = inputs.get("on");
    if (!on) return error({ code: "invalid-node-shape", nodeId: node.id, message: `Light sink ${JSON.stringify(node.id)} is missing input pin "on"` });
    return { ok: true };
  }

  if (node.type === "passthrough") {
    const input = [...inputs.values()];
    const output = [...outputs.values()];
    if (input.length !== 1 || output.length !== 1 || input[0]!.id !== output[0]!.id || input[0]!.type !== output[0]!.type) {
      return error({ code: "invalid-node-shape", nodeId: node.id, message: `Passthrough ${JSON.stringify(node.id)} must have one matching input/output pair` });
    }
    return { ok: true };
  }

  const template = def.template.make(`__validate_${node.type}`);
  const expectedInputs = expectedPinMap(template.inputs);
  const expectedOutputs = expectedPinMap(template.outputs);
  const variadicType = template.inputs.find((pin) => pin.variadic)?.type;
  const inputResult = validateRequiredPins(
    node,
    inputs,
    expectedInputs,
    "input",
    (pin) => node.type === "sink-call" || (variadicType !== undefined && /^i\d+$/.test(pin.id) && pin.type === variadicType),
  );
  if (!inputResult.ok) return inputResult;
  const outputResult = validateRequiredPins(node, outputs, expectedOutputs, "output", () => false);
  if (!outputResult.ok) return outputResult;

  for (const pinId of node.typeGroup ?? []) {
    const pin = inputs.get(pinId) ?? outputs.get(pinId);
    if (!pin || pin.type !== "any") {
      return error({ code: "invalid-pin", nodeId: node.id, message: `Node ${JSON.stringify(node.id)} has invalid generic type-group pin ${JSON.stringify(pinId)}` });
    }
  }
  return { ok: true };
}

/** Validate every reachable macro reference before expansion drops unresolved placements. */
export function validateReachableMacros(nodes: RuntimeNode[], macros: RuntimeMacroMap): GraphSemanticValidation {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (macroId: string): GraphSemanticValidation => {
    if (active.has(macroId)) return error({ code: "recursive-macro", message: `Macro dependency cycle includes ${JSON.stringify(macroId)}` });
    if (visited.has(macroId)) return { ok: true };
    const macro = ownValue(macros, macroId);
    if (!macro) return error({ code: "unknown-macro", message: `Unknown macro ${JSON.stringify(macroId)}` });
    active.add(macroId);
    for (const node of macro.nodes) {
      if (node.type !== "macro") continue;
      const result = visit(String(node.config?.macroId ?? ""));
      if (!result.ok) return result;
    }
    active.delete(macroId);
    visited.add(macroId);
    return { ok: true };
  };
  for (const node of nodes) {
    if (node.type !== "macro") continue;
    const result = visit(String(node.config?.macroId ?? ""));
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** Validate a fully expanded graph before it may reach evaluation or actuation. */
export function validateExpandedGraph(nodes: RuntimeNode[], edges: ViewEdge[]): GraphSemanticValidation {
  const byId = new Map<string, RuntimeNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      return error({ code: "invalid-node-shape", nodeId: node.id, message: `Expanded graph has duplicate node id ${JSON.stringify(node.id)}` });
    }
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    const shape = validateNodeShape(node);
    if (!shape.ok) return shape;
  }

  const edgeIds = new Set<string>();
  const incoming = new Set<string>();
  const graphEdges: Array<{ source: string; target: string }> = [];
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) return error({ code: "invalid-edge", edgeId: edge.id, message: `Duplicate edge id ${JSON.stringify(edge.id)}` });
    edgeIds.add(edge.id);
    const source = byId.get(edge.from.node);
    const target = byId.get(edge.to.node);
    const sourcePin = source?.outputs.find((pin) => pin.id === edge.from.pin);
    const targetPin = target?.inputs.find((pin) => pin.id === edge.to.pin);
    if (!source || !target || !sourcePin || !targetPin) {
      return error({ code: "invalid-edge", edgeId: edge.id, message: `Edge ${JSON.stringify(edge.id)} does not connect an existing output to an existing input` });
    }
    const targetKey = pinKey(edge.to.node, edge.to.pin);
    if (incoming.has(targetKey)) {
      return error({ code: "duplicate-input-source", edgeId: edge.id, nodeId: edge.to.node, message: `Input ${JSON.stringify(`${edge.to.node}:${edge.to.pin}`)} has more than one source` });
    }
    incoming.add(targetKey);
    if (!typesCompatible(sourcePin.type, targetPin.type)) {
      return error({ code: "type-mismatch", edgeId: edge.id, message: `Edge ${JSON.stringify(edge.id)} connects ${sourcePin.type} to ${targetPin.type}` });
    }
    if (source.id === target.id || wouldCreateCycle(graphEdges, source.id, target.id)) {
      return error({ code: "cycle", edgeId: edge.id, message: `Edge ${JSON.stringify(edge.id)} creates a cycle` });
    }
    graphEdges.push({ source: source.id, target: target.id });
  }
  return { ok: true };
}
