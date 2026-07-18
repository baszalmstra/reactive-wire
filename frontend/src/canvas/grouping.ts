import type { NodeData, PinDef } from "../../../shared/node-types.js";
import type { ViewEdge } from "../../../shared/engine/evaluate.js";
import { MACRO_IN, MACRO_OUT, makeMacroInstance, macroHasMemory, newMacroId, type MacroDef, type MacroMap } from "../../../shared/macros.js";
import { pinKey } from "../../../shared/identity.js";

export interface GroupResult {
  /** The new macro definition built from the selection. */
  def: MacroDef;
  /** The placement node that replaces the selection on the parent canvas. */
  instance: NodeData;
  /** Node ids removed from the parent canvas (the grouped selection). */
  removedNodeIds: string[];
  /** Edge ids removed from the parent canvas (internal + crossing edges). */
  removedEdgeIds: string[];
  /** New edges on the parent canvas that rewire crossing connections to the placement. */
  newEdges: ViewEdge[];
}

/**
 * Turn a selection into a macro: collect the selected nodes as the macro's subgraph, derive its
 * typed boundary from the wires that cross the selection, and produce a placement node to drop in
 * their place. A wire entering the selection becomes a macro input; a wire leaving it (or a pin
 * with no internal source that is read outside) becomes a macro output. Wires wholly inside the
 * selection move into the definition unchanged.
 */
export function groupSelection(
  nodes: NodeData[],
  edges: ViewEdge[],
  selectedIds: string[],
  macros: MacroMap,
  position: { x: number; y: number },
  name = "Macro",
): GroupResult | null {
  const sel = new Set(selectedIds);
  const selected = nodes.filter((n) => sel.has(n.id));
  if (selected.length === 0) return null;

  const internalEdges: ViewEdge[] = [];
  // A wire from outside into the selection: defines one macro input.
  const incoming: ViewEdge[] = [];
  // A wire from the selection out to the world: defines one macro output.
  const outgoing: ViewEdge[] = [];
  for (const e of edges) {
    const fromIn = sel.has(e.from.node);
    const toIn = sel.has(e.to.node);
    if (fromIn && toIn) internalEdges.push(e);
    else if (!fromIn && toIn) incoming.push(e);
    else if (fromIn && !toIn) outgoing.push(e);
  }

  // One macro input per distinct external source pin, so two inner consumers of the same external
  // wire share a single boundary input. Keyed by the source pin that feeds it. Each input gets its
  // own macro-in boundary node carrying a single pin, so the boundary can be edited pin by pin.
  const inputPins: PinDef[] = [];
  const inputKeyToPin = new Map<string, string>();
  const inBoundaryNodes: NodeData[] = [];
  const inBoundaryEdges: ViewEdge[] = [];
  let inSeq = 0;
  let inY = minY(selected);
  for (const e of incoming) {
    const key = pinKey(e.from.node, e.from.pin);
    let pinId = inputKeyToPin.get(key);
    if (!pinId) {
      pinId = `in${inSeq++}`;
      inputKeyToPin.set(key, pinId);
      const type = pinTypeOf(nodes, e.from.node, "out", e.from.pin) ?? pinTypeOf(nodes, e.to.node, "in", e.to.pin) ?? "any";
      const label = pinLabelOf(nodes, e.to.node, "in", e.to.pin) ?? pinId;
      inputPins.push({ id: pinId, label, type });
      inBoundaryNodes.push({
        id: boundaryInId(pinId), type: MACRO_IN, title: "Input", subtitle: "Macro input", icon: "io-in",
        x: minX(selected) - 240, y: inY, w: 180,
        inputs: [], outputs: [{ id: pinId, label, type }],
      });
      inY += 110;
    }
    // Inside the definition, the boundary input feeds the original inner consumer.
    inBoundaryEdges.push({ id: `bin-${e.id}`, from: { node: boundaryInId(pinId), pin: pinId }, to: { node: e.to.node, pin: e.to.pin } });
  }

  // One macro output per distinct internal source pin that leaves the selection, each on its own
  // macro-out boundary node so outputs are editable pin by pin too.
  const outputPins: PinDef[] = [];
  const outputKeyToPin = new Map<string, string>();
  const outBoundaryNodes: NodeData[] = [];
  const outBoundaryEdges: ViewEdge[] = [];
  let outSeq = 0;
  let outY = minY(selected);
  for (const e of outgoing) {
    const key = pinKey(e.from.node, e.from.pin);
    let pinId = outputKeyToPin.get(key);
    if (!pinId) {
      pinId = `out${outSeq++}`;
      outputKeyToPin.set(key, pinId);
      const type = pinTypeOf(nodes, e.from.node, "out", e.from.pin) ?? "any";
      const label = pinLabelOf(nodes, e.from.node, "out", e.from.pin) ?? pinId;
      outputPins.push({ id: pinId, label, type });
      outBoundaryNodes.push({
        id: boundaryOutId(pinId), type: MACRO_OUT, title: "Output", subtitle: "Macro output", icon: "io-out",
        x: maxX(selected) + 100, y: outY, w: 180,
        inputs: [{ id: pinId, label, type }], outputs: [],
      });
      outY += 110;
      outBoundaryEdges.push({ id: `bout-${pinId}`, from: { node: e.from.node, pin: e.from.pin }, to: { node: boundaryOutId(pinId), pin: pinId } });
    }
  }

  const id = newMacroId();
  const innerNodes = [...inBoundaryNodes, ...selected.map((n) => ({ ...n })), ...outBoundaryNodes];
  const innerEdges = [...internalEdges, ...inBoundaryEdges, ...outBoundaryEdges];
  const draft: MacroDef = {
    id, name,
    inputs: inputPins,
    outputs: outputPins,
    nodes: innerNodes,
    edges: innerEdges,
    stateful: false,
  };
  draft.stateful = macroHasMemory(draft, { ...macros, [id]: draft });

  const instance = makeMacroInstance(draft, `macro-${id}`, position.x, position.y);

  // Rewire the parent canvas: external sources now feed the placement's inputs; the placement's
  // outputs now feed the external consumers. Internal and crossing edges are removed.
  const newEdges: ViewEdge[] = [];
  for (const e of incoming) {
    const pinId = inputKeyToPin.get(pinKey(e.from.node, e.from.pin))!;
    newEdges.push({ id: `ng-${e.id}`, from: { node: e.from.node, pin: e.from.pin }, to: { node: instance.id, pin: pinId } });
  }
  for (const e of outgoing) {
    const pinId = outputKeyToPin.get(pinKey(e.from.node, e.from.pin))!;
    newEdges.push({ id: `ng-${e.id}`, from: { node: instance.id, pin: pinId }, to: { node: e.to.node, pin: e.to.pin } });
  }
  // Drop duplicate parent edges that map to the same (placement-output -> consumer) pair.
  const dedup = new Map(newEdges.map((e) => [JSON.stringify([e.from.node, e.from.pin, e.to.node, e.to.pin]), e]));

  return {
    def: draft,
    instance,
    removedNodeIds: selected.map((n) => n.id),
    removedEdgeIds: [...internalEdges, ...incoming, ...outgoing].map((e) => e.id),
    newEdges: [...dedup.values()],
  };
}

/** The id of the macro-in / macro-out boundary node that carries a given interface pin. */
function boundaryInId(pinId: string): string {
  return `mi-${pinId}`;
}
function boundaryOutId(pinId: string): string {
  return `mo-${pinId}`;
}

function pinTypeOf(nodes: NodeData[], nodeId: string, side: "in" | "out", pinId: string): PinDef["type"] | undefined {
  const n = nodes.find((x) => x.id === nodeId);
  const arr = side === "in" ? n?.inputs : n?.outputs;
  return arr?.find((p) => p.id === pinId)?.type;
}
function pinLabelOf(nodes: NodeData[], nodeId: string, side: "in" | "out", pinId: string): string | undefined {
  const n = nodes.find((x) => x.id === nodeId);
  const arr = side === "in" ? n?.inputs : n?.outputs;
  const p = arr?.find((x) => x.id === pinId);
  return p?.label || p?.id;
}

const minX = (ns: NodeData[]) => Math.min(...ns.map((n) => n.x));
const minY = (ns: NodeData[]) => Math.min(...ns.map((n) => n.y));
const maxX = (ns: NodeData[]) => Math.max(...ns.map((n) => n.x + (n.w ?? 210)));
