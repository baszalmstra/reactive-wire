export const MACRO_IN = "macro-in";
export const MACRO_OUT = "macro-out";
/** Whether a node type is a macro placement (an instance of a macro definition). */
export function isMacroInstance(type) {
    return type === "macro";
}
/** Whether a node is one of the boundary nodes that live only inside a definition canvas. */
export function isBoundary(type) {
    return type === MACRO_IN || type === MACRO_OUT;
}
/**
 * Whether a macro definition contains memory anywhere in its (possibly nested) subgraph, so a
 * placement can carry the "has memory" badge. Recurses into nested macro instances using the
 * supplied library; a missing dependency is treated as stateless.
 */
export function macroHasMemory(def, macros, seen = new Set()) {
    if (seen.has(def.id))
        return false;
    seen.add(def.id);
    for (const n of def.nodes) {
        if (n.stateful)
            return true;
        if (isMacroInstance(n.type)) {
            const inner = macros[String(n.config?.macroId ?? "")];
            if (inner && macroHasMemory(inner, macros, seen))
                return true;
        }
    }
    return false;
}
let macroSeq = 0;
/** A fresh macro id, unique enough across concurrent browser sessions. */
export function newMacroId() {
    macroSeq += 1;
    const rand = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
    return `macro_${Date.now().toString(36)}_${rand}_${macroSeq}`;
}
/**
 * Build a placement (instance) node for a macro. The placement mirrors the macro's boundary
 * pins so it wires like any other node; its config records which definition it instantiates.
 * Editable inputs let a placement supply a literal for an unconnected input, exactly as a
 * primitive node does.
 */
export function makeMacroInstance(def, id, x, y) {
    return {
        id,
        type: "macro",
        title: def.name,
        subtitle: "Macro",
        icon: "macro",
        x,
        y,
        w: 220,
        stateful: def.stateful,
        config: { macroId: def.id },
        inputs: def.inputs.map((p) => ({ ...p, editable: true })),
        outputs: def.outputs.map((p) => ({ ...p })),
    };
}
