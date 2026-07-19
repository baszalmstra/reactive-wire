import { useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUndoRedo } from "./use-undo-redo.js";
import type { EditorNode } from "../canvas/flows.js";

// The hook only ever swaps whole node/edge arrays, so the element shape is irrelevant here; a bare
// id is enough to tell one snapshot from another.
function node(id: string): EditorNode {
  return { id, position: { x: 0, y: 0 }, data: {} } as unknown as EditorNode;
}
function edge(id: string): Edge {
  return { id, source: "a", target: "b" } as Edge;
}

/**
 * Mirrors how App wires the hook: canvas state lives in useState, and refs are reassigned to the
 * latest arrays on every render before useUndoRedo runs. That ordering is what makes a lazily
 * captured checkpoint read the post-mutation arrays, so reproducing it faithfully is the point.
 */
function useHarness() {
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const ctrl = useUndoRedo({ nodesRef, edgesRef, setNodes, setEdges });
  return { nodes, edges, setNodes, setEdges, ctrl };
}

describe("useUndoRedo", () => {
  it("checkpoints the pre-mutation canvas when the mutation lands in the same React batch", () => {
    const { result } = renderHook(() => useHarness());

    // pushHistory and the add are dispatched together, so React reassigns nodesRef.current to the
    // post-add array in the same render the checkpoint is stored. The checkpoint must still hold the
    // empty canvas that existed at call time.
    act(() => {
      result.current.ctrl.pushHistory();
      result.current.setNodes([node("a")]);
    });
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.ctrl.canUndo).toBe(true);

    act(() => result.current.ctrl.undo());
    expect(result.current.nodes).toEqual([]);
    expect(result.current.ctrl.canUndo).toBe(false);
    expect(result.current.ctrl.canRedo).toBe(true);

    act(() => result.current.ctrl.redo());
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]!.id).toBe("a");
  });

  it("keeps redo available for an immediately following action", () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.ctrl.pushHistory();
      result.current.setNodes([node("a")]);
    });

    // This mirrors a user pressing Ctrl+Y immediately after Ctrl+Z. The redo snapshot must be
    // committed before undo returns rather than being enqueued from a later state updater.
    act(() => {
      result.current.ctrl.undo();
      result.current.ctrl.redo();
    });

    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.nodes[0]!.id).toBe("a");
  });

  it("restores nodes and edges together and clears the redo branch on a new checkpoint", () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.ctrl.pushHistory();
      result.current.setNodes([node("a"), node("b")]);
      result.current.setEdges([edge("a-b")]);
    });

    act(() => result.current.ctrl.undo());
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);

    act(() => result.current.ctrl.redo());
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);

    // A fresh checkpoint after an undo/redo cycle drops the redo branch.
    act(() => result.current.ctrl.undo());
    expect(result.current.ctrl.canRedo).toBe(true);
    act(() => {
      result.current.ctrl.pushHistory();
      result.current.setNodes([node("c")]);
    });
    expect(result.current.ctrl.canRedo).toBe(false);
  });
});
