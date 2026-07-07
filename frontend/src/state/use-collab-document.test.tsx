import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as Y from "yjs";
import type { Edge } from "@xyflow/react";
import {
  applyEditorSnapshotDiff,
  emptyEditorDocumentSnapshot,
  encodeUpdateBase64,
  type CollabNode,
  type EditorDocumentSnapshot,
} from "../../../shared/collab.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { MacroMap } from "../../../shared/macros.js";
import { useCollabDocument } from "./use-collab-document.js";
import type { Server } from "../server-conn.js";
import type { EditorNode, Flow } from "../canvas/flows.js";
import type { CanvasSnapshot } from "./use-undo-redo.js";

/**
 * A const-number node persisted with an extra output pin the current template no longer has. Reading
 * it heals the def (the stale pin is dropped), which is exactly the template drift that must not be
 * written back into the shared document merely by opening it.
 */
function driftedNode(id: string): CollabNode {
  const def: NodeData = {
    id, type: "const-number", title: "Number", subtitle: "Constant", icon: "const", x: 0, y: 0,
    inputs: [],
    outputs: [
      { id: "out", label: "value", type: "num", editable: true },
      { id: "stale", label: "stale", type: "num" },
    ],
    values: { out: 0 },
  };
  return { id, type: "rw", position: { x: 0, y: 0 }, dragHandle: ".rw-drag", data: { def } };
}

/** Base64-encoded full Yjs state for a document containing the given nodes on its single flow. */
function serverStateWith(nodes: CollabNode[]): string {
  const doc = new Y.Doc();
  const base = emptyEditorDocumentSnapshot();
  const snapshot: EditorDocumentSnapshot = { ...base, flows: [{ ...base.flows[0]!, nodes, edges: [] }] };
  applyEditorSnapshotDiff(doc, base, snapshot, "server");
  return encodeUpdateBase64(Y.encodeStateAsUpdate(doc));
}

function makeServer(docStateUpdate: string, sendDocUpdate: () => boolean): Server {
  return {
    connected: true,
    entities: {},
    lastResult: null,
    docState: { update: docStateUpdate, nonce: 1 },
    docUpdate: null,
    docError: null,
    deploy: () => false,
    sendDocUpdate,
  } as unknown as Server;
}

/** Drives useCollabDocument with real React state, exposing what a host component would hold. */
function useHarness(server: Server) {
  const [flows, setFlows] = useState<Flow[]>([{ id: "flow-1", name: "Flow 1", nodes: [], edges: [] }]);
  const [activeFlowId, setActiveFlowId] = useState("flow-1");
  const [nodes, setNodes] = useState<EditorNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const nodesRef = useRef<EditorNode[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const [macros, setMacros] = useState<MacroMap>({});
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [deployedFlowIds, setDeployedFlowIds] = useState<string[]>([activeFlowId]);
  const [, setSelected] = useState<string | null>(null);
  const [, setSelectedIds] = useState<string[]>([]);
  const [, setPast] = useState<CanvasSnapshot[]>([]);
  const [, setFuture] = useState<CanvasSnapshot[]>([]);
  useCollabDocument({
    server, flows, setFlows, activeFlowId, setActiveFlowId, nodes, edges, nodesRef, edgesRef,
    macros, replaceMacros: setMacros, autoDeploy, setAutoDeploy, deployedFlowIds, setDeployedFlowIds, setNodes, setEdges,
    setSelected, setSelectedIds, setPast, setFuture, showToast: () => {},
  });
  return { nodes, setFlows };
}

function outputIds(node: EditorNode): string[] {
  return (node as { data: { def: NodeData } }).data.def.outputs.map((p) => p.id);
}

describe("useCollabDocument template-drift healing", () => {
  it("does not write reconciled defs back to the document when a drifted doc is opened", async () => {
    const sendDocUpdate = vi.fn(() => true);
    const server = makeServer(serverStateWith([driftedNode("n1")]), sendDocUpdate);

    const { result } = renderHook(() => useHarness(server));

    // The remote snapshot was healed into editor state: the stale pin is gone.
    expect(outputIds(result.current.nodes[0]!)).toEqual(["out"]);

    // A benign re-render (same content, new array) lets the debounce flush actually run now that the
    // sync is no longer in progress. Because the diff baseline is the reconciled projection, the
    // flush finds no delta and broadcasts nothing; a raw baseline would send the healing delta here.
    sendDocUpdate.mockClear();
    // Two acts: the first commits the re-render so the debounce effect schedules its flush timer;
    // the second lets the 180ms timer fire. (Awaiting inside one act would sleep before the effect
    // that schedules the timer has even run.)
    await act(async () => { result.current.setFlows((flows) => [...flows]); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });

    expect(sendDocUpdate).not.toHaveBeenCalled();
  });
});
