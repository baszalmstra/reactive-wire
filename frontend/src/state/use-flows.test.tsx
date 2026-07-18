import { useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Memory } from "../../../shared/engine/evaluate.js";
import type { EditorNode } from "../canvas/flows.js";
import { useFlows } from "./use-flows.js";
import type { CanvasSnapshot } from "./use-undo-redo.js";

function node(id: string): EditorNode {
  return { id, position: { x: 0, y: 0 }, data: {} } as unknown as EditorNode;
}

function edge(id: string): Edge {
  return { id, source: "source", target: "target" } as Edge;
}

function useHarness() {
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const [, setSelected] = useState<string | null>(null);
  const [, setSelectedIds] = useState<string[]>([]);
  const [, setPast] = useState<CanvasSnapshot[]>([]);
  const [, setFuture] = useState<CanvasSnapshot[]>([]);
  const memories = useRef<Record<string, Memory>>({});
  const controls = useFlows({
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    setSelected,
    setSelectedIds,
    setPast,
    setFuture,
    memories,
  });
  return { nodes, edges, setNodes, setEdges, controls, memories };
}

describe("useFlows", () => {
  it("captures the active stores before addFlow clears them", () => {
    const { result } = renderHook(() => useHarness());
    const firstFlowId = result.current.controls.activeFlowId;
    const firstNodes = [node("first")];
    const firstEdges = [edge("first-edge")];

    act(() => {
      result.current.setNodes(firstNodes);
      result.current.setEdges(firstEdges);
    });
    act(() => result.current.controls.addFlow());

    const secondFlowId = result.current.controls.activeFlowId;
    expect(secondFlowId).not.toBe(firstFlowId);
    expect(result.current.nodes).toEqual([]);
    expect(result.current.edges).toEqual([]);

    const secondNodes = [node("second")];
    act(() => result.current.setNodes(secondNodes));
    act(() => result.current.controls.switchFlow(firstFlowId));

    expect(result.current.nodes).toBe(firstNodes);
    expect(result.current.edges).toBe(firstEdges);

    act(() => result.current.controls.switchFlow(secondFlowId));
    expect(result.current.nodes).toBe(secondNodes);
    expect(result.current.edges).toEqual([]);
  });

  it("preserves populated stores when closing active and inactive flows", () => {
    const { result } = renderHook(() => useHarness());
    const firstFlowId = result.current.controls.activeFlowId;
    const firstNodes = [node("first")];
    act(() => result.current.setNodes(firstNodes));
    act(() => result.current.controls.addFlow());

    const secondFlowId = result.current.controls.activeFlowId;
    const secondNodes = [node("second")];
    act(() => result.current.setNodes(secondNodes));
    act(() => result.current.controls.switchFlow(firstFlowId));

    // Closing the active first flow loads its populated neighbour, without side effects inside the
    // flow-state updater.
    act(() => result.current.controls.closeFlow(firstFlowId));
    expect(result.current.controls.activeFlowId).toBe(secondFlowId);
    expect(result.current.nodes).toBe(secondNodes);

    act(() => result.current.controls.addFlow());
    const thirdFlowId = result.current.controls.activeFlowId;
    const thirdNodes = [node("third")];
    act(() => result.current.setNodes(thirdNodes));

    // Closing an inactive flow leaves the populated active canvas untouched.
    act(() => result.current.controls.closeFlow(secondFlowId));
    expect(result.current.controls.activeFlowId).toBe(thirdFlowId);
    expect(result.current.nodes).toBe(thirdNodes);
    expect(result.current.controls.flows.map((flow) => flow.id)).not.toContain(secondFlowId);
  });
});
