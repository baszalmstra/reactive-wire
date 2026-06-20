import { describe, it, expect } from "vitest";
import { evaluate, type Memory, type ViewEdge } from "../shared/engine/evaluate.js";
import type { NodeData, PinDef } from "../shared/node-types.js";
import type { EntityMap } from "../shared/entities.js";
import { PALETTE, growVariadic, trailingVariadic } from "../frontend/src/canvas/node-templates.js";

// A source entity whose state stands in for one wired input value.
function source(id: string, entity_id: string, type: "bool" | "num"): NodeData {
  return {
    id, type: "entity", title: "", subtitle: "", icon: "bulb", x: 0, y: 0,
    config: { entity_id },
    inputs: [], outputs: [{ id: "state", label: "", type }],
  };
}

// A reducer node (and/or/sum) wired from `count` sources onto pins i0..i{count-1}.
function reducer(type: string, elem: "bool" | "num", count: number): { nodes: NodeData[]; edges: ViewEdge[] } {
  const inputs: PinDef[] = Array.from({ length: count }, (_, i) => ({ id: `i${i}`, label: "in", type: elem }));
  const node: NodeData = {
    id: "r", type, title: "", subtitle: "", icon: "and", x: 0, y: 0,
    inputs, outputs: [{ id: "out", label: "", type: type === "sum" ? "num" : "bool" }],
  };
  const sources = Array.from({ length: count }, (_, i) => source(`s${i}`, `e.${i}`, elem));
  const edges: ViewEdge[] = sources.map((s, i) => ({ id: `e${i}`, from: { node: s.id, pin: "state" }, to: { node: "r", pin: `i${i}` } }));
  return { nodes: [...sources, node], edges };
}

const out = (g: { nodes: NodeData[]; edges: ViewEdge[] }, entities: EntityMap) =>
  evaluate(g.nodes, g.edges, entities, {} as Memory).outputs["r:out"]!;

describe("variadic fold semantics — arbitrary arity", () => {
  it("AND folds over every connected input (all true -> true)", () => {
    const g = reducer("and", "bool", 4);
    const v = out(g, { "e.0": s("on"), "e.1": s("on"), "e.2": s("on"), "e.3": s("on") });
    expect(v.status).toBe("ok");
    expect(v.v).toBe(true);
  });

  it("AND is Kleene: one ok-false determines false even with an unavailable input", () => {
    const g = reducer("and", "bool", 3);
    const v = out(g, { "e.0": s("on"), "e.1": s("off") }); // e.2 missing -> unavailable
    expect(v.status).toBe("ok");
    expect(v.v).toBe(false);
  });

  it("AND is undetermined when all-true-so-far but an input is unavailable", () => {
    const g = reducer("and", "bool", 3);
    const v = out(g, { "e.0": s("on"), "e.1": s("on") }); // e.2 missing
    expect(v.status).toBe("unavailable");
  });

  it("OR is Kleene: one ok-true determines true even with an unavailable input", () => {
    const g = reducer("or", "bool", 3);
    const v = out(g, { "e.0": s("off"), "e.1": s("on") }); // e.2 missing
    expect(v.status).toBe("ok");
    expect(v.v).toBe(true);
  });

  it("SUM adds every connected input", () => {
    const g = reducer("sum", "num", 5);
    const v = out(g, { "e.0": n(1), "e.1": n(2), "e.2": n(3), "e.3": n(4), "e.4": n(5) });
    expect(v.status).toBe("ok");
    expect(v.v).toBe(15);
  });

  it("SUM is strict: any non-ok input makes the whole sum unavailable", () => {
    const g = reducer("sum", "num", 3);
    const v = out(g, { "e.0": n(1), "e.1": n(2) }); // e.2 missing
    expect(v.status).toBe("unavailable");
  });

  it("the trailing empty variadic pin contributes nothing when left unconnected", () => {
    // Two wired inputs plus an extra unconnected typed pin (as the editor's open trailing pin).
    const g = reducer("sum", "num", 2);
    g.nodes.find((x) => x.id === "r")!.inputs.push({ id: "i2", label: "", type: "num", variadic: true });
    const v = out(g, { "e.0": n(4), "e.1": n(6) });
    expect(v.v).toBe(10);
  });
});

function s(state: string): EntityMap[string] { return { state, attributes: {} }; }
function n(x: number): EntityMap[string] { return { state: String(x), attributes: {} }; }

describe("variadic auto-grow pin lists", () => {
  it("every reducer template ships exactly one trailing empty pin", () => {
    for (const type of ["and", "or", "sum"]) {
      const def = PALETTE.find((t) => t.type === type)!.make(type);
      const open = trailingVariadic(def);
      expect(open).toBeDefined();
      expect(open!.label).toBe("");
      // Only the last pin is variadic — the others are concrete.
      expect(def.inputs.filter((p) => p.variadic)).toHaveLength(1);
      expect(def.inputs[def.inputs.length - 1]!.variadic).toBe(true);
    }
  });

  it("connecting the trailing pin fills it and appends a fresh trailing pin", () => {
    const def = PALETTE.find((t) => t.type === "and")!.make("and");
    const open = trailingVariadic(def)!;
    const grown = growVariadic(def, open.id);

    // The previously-open pin is now concrete (keeps its id and element type, no longer variadic).
    const filled = grown.inputs.find((p) => p.id === open.id)!;
    expect(filled.variadic).toBeUndefined();
    expect(filled.type).toBe(open.type);

    // Exactly one new trailing empty pin, with a fresh stable id.
    const newOpen = trailingVariadic(grown)!;
    expect(newOpen.id).not.toBe(open.id);
    expect(grown.inputs).toHaveLength(def.inputs.length + 1);
    expect(grown.inputs.filter((p) => p.variadic)).toHaveLength(1);
  });

  it("growing is idempotent for non-trailing pins (connecting an existing pin grows nothing)", () => {
    const def = PALETTE.find((t) => t.type === "and")!.make("and");
    const grown = growVariadic(def, "i0");
    expect(grown).toBe(def);
  });

  it("new pin ids never collide so wire->pin mappings stay stable across grows", () => {
    let def = PALETTE.find((t) => t.type === "sum")!.make("sum");
    const seen = new Set(def.inputs.map((p) => p.id));
    for (let i = 0; i < 5; i++) {
      const open = trailingVariadic(def)!;
      def = growVariadic(def, open.id);
      const newOpen = trailingVariadic(def)!;
      expect(seen.has(newOpen.id)).toBe(false);
      seen.add(newOpen.id);
    }
  });

  it("a grown-then-serialized node round-trips through evaluate at its new arity", () => {
    // Simulate the editor: grow SUM to four wired inputs, serialize the def (JSON round-trip),
    // and confirm the engine folds over all four connected pins on the restored graph.
    let sumDef = PALETTE.find((t) => t.type === "sum")!.make("r");
    const edges: ViewEdge[] = [];
    const sources: NodeData[] = [];
    const wireValues = [10, 20, 30, 40];
    wireValues.forEach((_, i) => {
      const open = trailingVariadic(sumDef)!;
      // Wire onto the currently-open pin, then grow it (mirrors onConnect order in the editor).
      edges.push({ id: `e${i}`, from: { node: `s${i}`, pin: "state" }, to: { node: "r", pin: open.id } });
      sources.push(source(`s${i}`, `e.${i}`, "num"));
      sumDef = growVariadic(sumDef, open.id);
    });

    const serialized = JSON.parse(JSON.stringify({ node: sumDef, edges })) as { node: NodeData; edges: ViewEdge[] };
    const nodes = [...sources, serialized.node];
    const entities: EntityMap = Object.fromEntries(wireValues.map((v, i) => [`e.${i}`, n(v)]));
    const v = evaluate(nodes, serialized.edges, entities, {} as Memory).outputs["r:out"]!;
    expect(v.status).toBe("ok");
    expect(v.v).toBe(100);
  });
});
