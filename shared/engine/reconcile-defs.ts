import type { NodeData, PinDef } from "../node-types.js";
import { paletteDefs } from "./nodes/index.js";

/** Whether a node/pin still carries a wire; a ghost pin with no wire is safe to drop. */
export type IsWired = (nodeId: string, pinId: string) => boolean;

export interface ReconcileOptions {
  /**
   * Reports whether a node/pin still has a connected edge. When omitted, every pin is treated as
   * wired, so stored pins the template no longer has are ghosted but never dropped — the safe
   * default when wiring is unknown.
   */
  isWired?: IsWired;
}

/** The canonical current pin shapes for a node type, taken from its palette template. */
export type NodeTemplates = ReadonlyMap<string, NodeData>;

/**
 * The current template pin shapes keyed by node type, built from the palette definitions. Entity
 * nodes are present but reconcileDefs skips them (their pins track live attributes); macro
 * placements and boundary/passthrough internals are absent, so they read as unknown types and are
 * left untouched.
 */
let cachedTemplates: NodeTemplates | undefined;

export function currentNodeTemplates(): NodeTemplates {
  if (cachedTemplates) return cachedTemplates;
  const map = new Map<string, NodeData>();
  for (const def of paletteDefs) map.set(def.type, def.template.make(`__template_${def.type}`));
  cachedTemplates = map;
  return map;
}

/**
 * Reconcile stored node defs against the current templates so a persisted graph heals to the code's
 * present pin shapes when it is read. For each stored node whose type has a template (entity nodes
 * excepted): pins the template added but the def lacks are appended with template defaults; stored
 * pins the template no longer has are marked ghost so their wires survive, and dropped only when
 * unwired; unknown node types are returned untouched. A node is returned by identity when nothing
 * changed, so re-reading an already-current graph is a no-op.
 */
export function reconcileDefs(nodes: NodeData[], templates: NodeTemplates, options: ReconcileOptions = {}): NodeData[] {
  const isWired = options.isWired ?? (() => true);
  return nodes.map((node) => {
    // Entity nodes track live attributes, and light sinks track their target light's capabilities;
    // both shape their own pins per entity, so healing them against a static template would fight it.
    if (node.type === "entity" || node.type === "sink-light") return node;
    const template = templates.get(node.type);
    if (!template) return node;
    // A collaborative def can arrive with malformed pin arrays; leave it for the deploy sanitizer
    // to reject rather than reshaping it here.
    if (!Array.isArray(node.inputs) || !Array.isArray(node.outputs)) return node;
    return reconcileNode(node, template, isWired);
  });
}

function reconcileNode(node: NodeData, template: NodeData, isWired: IsWired): NodeData {
  const inputs = reconcilePins(node.inputs, template.inputs, (pinId) => isWired(node.id, pinId));
  const outputs = reconcilePins(node.outputs, template.outputs, (pinId) => isWired(node.id, pinId));
  const values = { ...(node.values ?? {}) };
  let valuesChanged = false;
  for (const pin of [...inputs, ...outputs]) {
    if (pin.editable && !(pin.id in values) && template.values && pin.id in template.values) {
      values[pin.id] = template.values[pin.id];
      valuesChanged = true;
    }
  }
  if (samePins(node.inputs, inputs) && samePins(node.outputs, outputs) && !valuesChanged) return node;
  const next: NodeData = { ...node, inputs, outputs };
  if (node.values || valuesChanged) next.values = values;
  return next;
}

/**
 * Reconcile one pin list (inputs or outputs) against the template's. Template pins come first in
 * template order — a stored pin is kept (cleared of any stale ghost) so its edits persist, a
 * template pin the def lacks is inserted at its template position so a healed node matches a freshly
 * created one. Stored pins the template no longer names follow in their stored order: a variadic
 * template (AND/OR/SUM) grows extra `iN` input pins beyond its fixed set, so those are kept verbatim
 * rather than ghosted — the conservative choice that never disturbs a grown variadic node; other
 * unnamed pins become ghosts to keep their wires, and are dropped once unwired.
 */
function reconcilePins(stored: PinDef[], template: PinDef[], isWired: (pinId: string) => boolean): PinDef[] {
  const storedById = new Map(stored.map((p) => [p.id, p]));
  const templateIds = new Set(template.map((p) => p.id));
  const templateVariadic = template.some((p) => p.variadic);
  const out: PinDef[] = [];
  for (const pin of template) {
    const kept = storedById.get(pin.id);
    if (!kept) out.push({ ...pin });
    else out.push(kept.ghost ? clearGhost(kept) : kept);
  }
  for (const pin of stored) {
    if (templateIds.has(pin.id)) continue;
    if (templateVariadic || pin.variadic) out.push(pin);
    else if (isWired(pin.id)) out.push(ghostPin(pin));
  }
  return out;
}

/** Mark a pin the template no longer exposes as a ghost, preserving its identity for any wires. */
function ghostPin(pin: PinDef): PinDef {
  return { ...pin, ghost: true, missing: pin.missing ?? pin.label ?? pin.id };
}

/** Drop a stale ghost marking once the template exposes the pin again. */
function clearGhost(pin: PinDef): PinDef {
  const { ghost: _ghost, missing: _missing, ...rest } = pin;
  return rest;
}

function samePins(a: PinDef[], b: PinDef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pin, i) => pin === b[i]);
}
