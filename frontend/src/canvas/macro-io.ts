import { isMacroInstance, newMacroId, type MacroMap } from "../../../shared/macros.js";

/** A self-contained macro bundle: the macro plus every macro it transitively depends on. */
export interface MacroBundle {
  format: "reactive-wire-macro";
  version: 1;
  /** The id of the bundle's top-level macro within `macros`. */
  rootId: string;
  /** Every definition the root needs, keyed by id. */
  macros: MacroMap;
}

/** The ids of every macro the given macro depends on (transitively), including itself. */
export function collectDeps(rootId: string, macros: MacroMap, seen: Set<string> = new Set()): Set<string> {
  if (seen.has(rootId)) return seen;
  const def = macros[rootId];
  if (!def) return seen;
  seen.add(rootId);
  for (const n of def.nodes) {
    if (isMacroInstance(n.type)) {
      const dep = String(n.config?.macroId ?? "");
      if (dep) collectDeps(dep, macros, seen);
    }
  }
  return seen;
}

/** Serialize a macro and all its nested dependencies into a portable bundle. */
export function exportMacro(rootId: string, macros: MacroMap): MacroBundle {
  const deps = collectDeps(rootId, macros);
  const bundled: MacroMap = {};
  for (const id of deps) {
    const def = macros[id];
    if (def) bundled[id] = def;
  }
  return { format: "reactive-wire-macro", version: 1, rootId, macros: bundled };
}

/** A parsed bundle is rejected unless it carries the expected format marker and a known root. */
export function parseBundle(text: string): MacroBundle | null {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.format === "reactive-wire-macro" && obj.macros && obj.rootId && obj.macros[obj.rootId]) {
      return obj as MacroBundle;
    }
  } catch {
    /* not valid JSON */
  }
  return null;
}

/**
 * Bring an imported bundle into a macro library as a fresh, forkable copy. Every macro in the
 * bundle is reassigned a new id (and every internal placement is rewired to the new ids), so the
 * import never collides with or silently overwrites a macro already present — and the user owns
 * an editable fork rather than a locked reference. Returns the updated library and the new root
 * id of the imported macro.
 */
export function importBundle(bundle: MacroBundle, into: MacroMap): { macros: MacroMap; rootId: string } {
  // Map each bundle id to a fresh id so the import is independent of the source library.
  const remap = new Map<string, string>();
  for (const id of Object.keys(bundle.macros)) remap.set(id, newMacroId());

  const next: MacroMap = { ...into };
  for (const [oldId, def] of Object.entries(bundle.macros)) {
    const newId = remap.get(oldId)!;
    next[newId] = {
      ...def,
      id: newId,
      nodes: def.nodes.map((n) =>
        isMacroInstance(n.type)
          ? { ...n, config: { ...n.config, macroId: remap.get(String(n.config?.macroId ?? "")) ?? n.config?.macroId } }
          : n,
      ),
    };
  }
  return { macros: next, rootId: remap.get(bundle.rootId)! };
}
