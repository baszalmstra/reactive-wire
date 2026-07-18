import { describe, expect, it } from "vitest";
import { runtimeGraphFingerprint } from "../shared/engine/graph-fingerprint.js";
import type { RuntimeNode } from "../shared/runtime-types.js";

function constant(id: string, value: number): RuntimeNode {
  return {
    id,
    type: "const-number",
    inputs: [],
    outputs: [{ id: "out", label: "", type: "num" }],
    values: { out: value },
  };
}

describe("runtime graph fingerprint", () => {
  it("ignores collection and object-key order but changes with runtime semantics", () => {
    const a = constant("a", 1);
    const b = constant("b", 2);
    a.config = { z: 1, a: 2 };
    const first = runtimeGraphFingerprint([a, b], [], {});
    const reordered = runtimeGraphFingerprint(
      [{ ...b }, { ...a, config: { a: 2, z: 1 } }],
      [],
      {},
    );
    expect(reordered).toBe(first);
    expect(runtimeGraphFingerprint([constant("a", 3), b], [], {})).not.toBe(first);
  });
});
