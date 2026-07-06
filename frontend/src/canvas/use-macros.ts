import { useCallback, useState } from "react";
import type { MacroDef, MacroMap } from "../../../shared/macros.js";
export { syncMacroInstance as syncInstance } from "./macro-editing.js";

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
  const replace = useCallback((m: MacroMap) => setMacros((current) => (JSON.stringify(current) === JSON.stringify(m) ? current : m)), []);
  return { macros, put, remove, replace };
}
