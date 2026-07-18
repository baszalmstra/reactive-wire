import type { RuntimeMacroMap } from "../macros.js";
import type { RuntimeNode, RuntimePin } from "../runtime-types.js";
import type { ViewEdge } from "./evaluate.js";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function pin(pin: RuntimePin): unknown {
  return {
    id: pin.id,
    type: pin.type,
    ...(pin.variadic ? { variadic: true } : {}),
    ...(pin.ghost ? { ghost: true } : {}),
  };
}

function node(node: RuntimeNode): unknown {
  return {
    id: node.id,
    type: node.type,
    config: canonical(node.config ?? null),
    values: canonical(node.values ?? null),
    typeGroup: node.typeGroup ?? null,
    inputs: node.inputs.map(pin),
    outputs: node.outputs.map(pin),
  };
}

function edge(edge: ViewEdge): unknown {
  return { from: edge.from, to: edge.to };
}

function sortedNodes(nodes: RuntimeNode[]): unknown[] {
  return [...nodes].sort((a, b) => a.id.localeCompare(b.id)).map(node);
}

function sortedEdges(edges: ViewEdge[]): unknown[] {
  return [...edges]
    .sort((a, b) => `${a.from.node}:${a.from.pin}>${a.to.node}:${a.to.pin}`.localeCompare(`${b.from.node}:${b.from.pin}>${b.to.node}:${b.to.pin}`))
    .map(edge);
}

function semanticMacros(macros: RuntimeMacroMap): unknown {
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(macros).sort()) {
    const macro = macros[id]!;
    out[id] = {
      id: macro.id,
      inputs: macro.inputs.map(pin),
      outputs: macro.outputs.map(pin),
      nodes: sortedNodes(macro.nodes),
      edges: sortedEdges(macro.edges),
    };
  }
  return out;
}

/** A compact deterministic identity for exactly the runtime semantics submitted to the server. */
export function runtimeGraphFingerprint(
  nodes: RuntimeNode[],
  edges: ViewEdge[],
  macros: RuntimeMacroMap = {},
): string {
  const semantic = JSON.stringify({
    nodes: sortedNodes(nodes),
    edges: sortedEdges(edges),
    macros: semanticMacros(macros),
  });
  // Two independent 32-bit FNV-1a streams make accidental/crafted UI identity collisions much
  // less likely while keeping runtime frames fixed-size. This fingerprint gates presentation only;
  // the server still validates and owns all actuation decisions.
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < semantic.length; i += 1) {
    const code = semantic.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
  }
  return `${semantic.length.toString(16)}-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
