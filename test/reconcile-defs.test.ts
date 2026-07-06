import { describe, expect, it } from "vitest";
import type { NodeData } from "../shared/node-types.js";
import { currentNodeTemplates, reconcileDefs, type NodeTemplates } from "../shared/engine/reconcile-defs.js";

function def(partial: Partial<NodeData> & { id: string; type: string }): NodeData {
  return {
    title: "", subtitle: "", icon: "const", x: 0, y: 0,
    inputs: [], outputs: [],
    ...partial,
  };
}

function templates(...defs: NodeData[]): NodeTemplates {
  return new Map(defs.map((d) => [d.type, d]));
}

const wiredNone = () => false;
const wiredAll = () => true;

describe("reconcileDefs", () => {
  it("adds a pin the template gained, seeding its default while preserving stored values", () => {
    const stored = def({
      id: "n", type: "widget",
      inputs: [{ id: "a", label: "a", type: "num", editable: true }],
      values: { a: 5 },
    });
    const template = def({
      id: "t", type: "widget",
      inputs: [
        { id: "a", label: "a", type: "num", editable: true },
        { id: "b", label: "b", type: "num", editable: true },
      ],
      values: { a: 0, b: 7 },
    });

    const out = reconcileDefs([stored], templates(template))[0]!;

    expect(out.inputs.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out.values).toEqual({ a: 5, b: 7 });
  });

  it("ghosts a stored pin the template dropped while it is still wired", () => {
    const stored = def({
      id: "n", type: "widget",
      inputs: [{ id: "a", label: "a", type: "num" }, { id: "b", label: "b", type: "num" }],
    });
    const template = def({ id: "t", type: "widget", inputs: [{ id: "a", label: "a", type: "num" }] });

    const out = reconcileDefs([stored], templates(template), { isWired: wiredAll })[0]!;

    const b = out.inputs.find((p) => p.id === "b");
    expect(b?.ghost).toBe(true);
    expect(b?.missing).toBe("b");
    expect(out.inputs.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("drops a stored pin the template dropped once it is unwired", () => {
    const stored = def({
      id: "n", type: "widget",
      inputs: [{ id: "a", label: "a", type: "num" }, { id: "b", label: "b", type: "num" }],
    });
    const template = def({ id: "t", type: "widget", inputs: [{ id: "a", label: "a", type: "num" }] });

    const out = reconcileDefs([stored], templates(template), { isWired: wiredNone })[0]!;

    expect(out.inputs.map((p) => p.id)).toEqual(["a"]);
  });

  it("clears a stale ghost when the template exposes the pin again", () => {
    const stored = def({
      id: "n", type: "widget",
      inputs: [{ id: "a", label: "a", type: "num", ghost: true, missing: "a" }],
    });
    const template = def({ id: "t", type: "widget", inputs: [{ id: "a", label: "a", type: "num" }] });

    const out = reconcileDefs([stored], templates(template))[0]!;

    const a = out.inputs[0]!;
    expect(a.ghost).toBeUndefined();
    expect(a.missing).toBeUndefined();
  });

  it("leaves unknown node types untouched", () => {
    const stored = def({ id: "n", type: "mystery", inputs: [{ id: "x", label: "x", type: "num" }] });

    const out = reconcileDefs([stored], templates())[0]!;

    expect(out).toBe(stored);
  });

  it("leaves entity nodes to their own live-attribute ghost logic", () => {
    const stored = def({
      id: "e", type: "entity",
      outputs: [{ id: "state", label: "state", type: "str" }, { id: "brightness", label: "b", type: "num" }],
    });
    // A template that differs would rewrite the pins if entity were reconciled; it must not be.
    const template = def({ id: "t", type: "entity", outputs: [{ id: "state", label: "state", type: "str" }] });

    const out = reconcileDefs([stored], templates(template))[0]!;

    expect(out).toBe(stored);
  });

  it("keeps grown variadic pins that the template does not name", () => {
    const variadicTemplate = def({
      id: "t", type: "and",
      inputs: [
        { id: "i0", label: "in", type: "bool" },
        { id: "i1", label: "in", type: "bool" },
        { id: "i2", label: "", type: "bool", variadic: true },
      ],
    });
    const stored = def({
      id: "n", type: "and",
      inputs: [
        { id: "i0", label: "in", type: "bool" },
        { id: "i1", label: "in", type: "bool" },
        { id: "i2", label: "in", type: "bool" },
        { id: "i3", label: "", type: "bool", variadic: true },
      ],
    });

    const out = reconcileDefs([stored], templates(variadicTemplate), { isWired: wiredNone })[0]!;

    expect(out.inputs.map((p) => p.id)).toEqual(["i0", "i1", "i2", "i3"]);
    expect(out.inputs.every((p) => !p.ghost)).toBe(true);
    // Unchanged variadic node returns by identity.
    expect(out).toBe(stored);
  });

  it("reconciles the real AND template without disturbing a saved variadic graph", () => {
    const stored = def({
      id: "n", type: "and",
      inputs: [
        { id: "i0", label: "in", type: "bool" },
        { id: "i1", label: "in", type: "bool" },
        { id: "i2", label: "in", type: "bool" },
        { id: "i3", label: "", type: "bool", variadic: true },
      ],
      outputs: [{ id: "out", label: "all true", type: "bool" }],
    });

    const out = reconcileDefs([stored], currentNodeTemplates(), { isWired: wiredNone })[0]!;

    expect(out.inputs.map((p) => p.id)).toEqual(["i0", "i1", "i2", "i3"]);
    expect(out.inputs.every((p) => !p.ghost)).toBe(true);
  });
});
