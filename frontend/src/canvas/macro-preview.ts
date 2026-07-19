import { useEffect, useState } from "react";
import type { NodeData } from "../../../shared/node-types.js";
import type { MacroMap } from "../../../shared/macros.js";
import { createMemory } from "../../../shared/engine/engine-support.js";
import { evaluate, type ViewEdge } from "../../../shared/engine/evaluate.js";
import { emptyResults, type EvalResults } from "../../../shared/results.js";
import type { EvaluationEnvironment } from "../../../shared/home.js";

/**
 * Macro definition previews show the graph's current shape, not a simulated event history. A
 * fixed timestamp and a new scratch memory map make each committed preview deterministic: edge,
 * fold, toggle, and transient-sink state can never leak between React renders.
 */
export const MACRO_PREVIEW_NOW = 0;
const EMPTY_ENVIRONMENT: EvaluationEnvironment = {};

export function evaluateMacroPreview(
  nodes: NodeData[],
  edges: ViewEdge[],
  macros: MacroMap,
  environment: EvaluationEnvironment = EMPTY_ENVIRONMENT,
): EvalResults {
  return evaluate(nodes, edges, {}, createMemory(), MACRO_PREVIEW_NOW, {}, macros, environment);
}

/** Evaluate only after React commits a changed graph or macro library. */
export function useMacroPreview(
  nodes: NodeData[],
  edges: ViewEdge[],
  macros: MacroMap,
  environment: EvaluationEnvironment = EMPTY_ENVIRONMENT,
): EvalResults {
  const [results, setResults] = useState<EvalResults>(() => emptyResults());
  useEffect(() => {
    setResults(evaluateMacroPreview(nodes, edges, macros, environment));
  }, [nodes, edges, macros, environment]);
  return results;
}
