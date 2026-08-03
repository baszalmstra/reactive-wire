import { describe, expect, it } from "vitest";
import { nodeGeom, type NodeData } from "../../../shared/node-types.js";
import type { RWNodeType } from "./validation.js";
import { COMMENT_PAD, COMMENT_TITLE_GAP, frameAroundNodes } from "./comments.js";

function def(id: string): NodeData {
  return { id, type: "const", title: id, subtitle: "", icon: "const", x: 0, y: 0, inputs: [], outputs: [] };
}

function node(id: string, x: number, y: number): RWNodeType {
  return { id, type: "rw", position: { x, y }, data: { def: def(id) } } as RWNodeType;
}

describe("frameAroundNodes", () => {
  it("returns null for an empty selection so the caller can place a free-standing frame", () => {
    expect(frameAroundNodes([])).toBeNull();
  });

  it("pads a single node on every side, leaving extra room above for the title bar", () => {
    const g = nodeGeom(def("a"));

    const frame = frameAroundNodes([node("a", 100, 200)]);

    expect(frame).toEqual({
      x: 100 - COMMENT_PAD,
      y: 200 - COMMENT_PAD - COMMENT_TITLE_GAP,
      w: g.w + COMMENT_PAD * 2,
      h: g.h + COMMENT_PAD * 2 + COMMENT_TITLE_GAP,
    });
  });

  it("spans every node in a multi-selection rather than only the first", () => {
    const g = nodeGeom(def("a"));

    const frame = frameAroundNodes([node("a", 100, 100), node("b", 400, 300)]);

    // The far node sits 300 right and 200 below the near one, so the frame grows by that much.
    expect(frame).toEqual({
      x: 100 - COMMENT_PAD,
      y: 100 - COMMENT_PAD - COMMENT_TITLE_GAP,
      w: 300 + g.w + COMMENT_PAD * 2,
      h: 200 + g.h + COMMENT_PAD * 2 + COMMENT_TITLE_GAP,
    });
  });

  it("anchors on the top-left extent whatever order the nodes arrive in", () => {
    const ordered = frameAroundNodes([node("a", 100, 100), node("b", 400, 300)]);
    const reversed = frameAroundNodes([node("b", 400, 300), node("a", 100, 100)]);

    expect(reversed).toEqual(ordered);
  });

  it("encloses a node placed above and left of the others", () => {
    const g = nodeGeom(def("a"));

    const frame = frameAroundNodes([node("a", 500, 500), node("b", 200, 150)]);

    expect(frame!.x).toBe(200 - COMMENT_PAD);
    expect(frame!.y).toBe(150 - COMMENT_PAD - COMMENT_TITLE_GAP);
    expect(frame!.w).toBe(300 + g.w + COMMENT_PAD * 2);
    expect(frame!.h).toBe(350 + g.h + COMMENT_PAD * 2 + COMMENT_TITLE_GAP);
  });
});
