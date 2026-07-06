import { describe, expect, it } from "vitest";
import type { Connection, Edge } from "@xyflow/react";
import { connectionAlreadyWired, replaceInputEdge } from "./wire-replace.js";

function edge(id: string, source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id, source, sourceHandle, target, targetHandle, type: "rw" };
}

const intoC: Connection = { source: "B", sourceHandle: "out", target: "C", targetHandle: "in" };

describe("replaceInputEdge", () => {
  it("adds the wire untouched when the target input is empty", () => {
    const existing = [edge("A-out__X-in", "A", "out", "X", "in")];
    const next = replaceInputEdge(existing, intoC);

    // The unrelated wire survives and the new B -> C:in wire is added.
    expect(next).toHaveLength(2);
    expect(next).toContainEqual(existing[0]);
    expect(next.some((e) => e.source === "B" && e.target === "C" && e.targetHandle === "in")).toBe(true);
  });

  it("drops the wire already on the target input and lands the new one in its place", () => {
    const old = edge("A-out__C-in", "A", "out", "C", "in");
    const next = replaceInputEdge([old], intoC);

    // Exactly one wire into C:in, and it is the new source, not the replaced one.
    const intoTarget = next.filter((e) => e.target === "C" && e.targetHandle === "in");
    expect(intoTarget).toHaveLength(1);
    expect(intoTarget[0]!.source).toBe("B");
    expect(next).not.toContainEqual(old);
  });

  it("only replaces the same input pin, leaving other pins of the same node alone", () => {
    const otherPin = edge("A-out__C-gate", "A", "out", "C", "gate");
    const occupying = edge("A-out__C-in", "A", "out", "C", "in");
    const next = replaceInputEdge([otherPin, occupying], intoC);

    // C's other input pin keeps its wire; only C:in is replaced.
    expect(next).toContainEqual(otherPin);
    expect(next.filter((e) => e.target === "C" && e.targetHandle === "in")).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe("connectionAlreadyWired", () => {
  it("is true only when the exact same source, target, and handles are already wired", () => {
    const edges = [edge("A-out__C-in", "A", "out", "C", "in")];
    expect(connectionAlreadyWired(edges, intoC)).toBe(false); // B -> C:in, different source
    expect(connectionAlreadyWired(edges, { source: "A", sourceHandle: "out", target: "C", targetHandle: "in" })).toBe(true);
  });

  it("distinguishes a different pin on the same node pair", () => {
    const edges = [edge("A-out__C-in", "A", "out", "C", "in")];
    expect(connectionAlreadyWired(edges, { source: "A", sourceHandle: "out", target: "C", targetHandle: "gate" })).toBe(false);
  });
});
