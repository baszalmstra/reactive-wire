import { useCallback, useState } from "react";
import type { NodeData } from "../../../shared/node-types.js";
import { isMacroInstance, macroHasMemory, type MacroDef, type MacroMap } from "../../../shared/macros.js";

export interface MacroLibrary {
  macros: MacroMap;
  /** Insert or replace a definition. */
  put: (def: MacroDef) => void;
  /** Remove a definition by id. */
  remove: (id: string) => void;
  /** Replace the whole library (used by import). */
  replace: (macros: MacroMap) => void;
}

/** The editor's in-memory macro library. */
export function useMacros(initial: MacroMap = {}): MacroLibrary {
  const [macros, setMacros] = useState<MacroMap>(initial);
  const put = useCallback((def: MacroDef) => setMacros((m) => ({ ...m, [def.id]: def })), []);
  const remove = useCallback((id: string) => setMacros((m) => { const n = { ...m }; delete n[id]; return n; }), []);
  const replace = useCallback((m: MacroMap) => setMacros(m), []);
  return { macros, put, remove, replace };
}

/**
 * Bring a placement's pins, title and memory flag back in line with its definition. Editing a
 * macro updates every placement's interface (a renamed/added pin, a now-stateful body) while
 * leaving the placement's own config and literal values untouched. A placement of a deleted macro
 * is left as-is so its wiring is not silently dropped.
 */
export function syncInstance(node: NodeData, macros: MacroMap): NodeData {
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
