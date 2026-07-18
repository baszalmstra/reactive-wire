import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";
import type { MacroMap } from "../../../shared/macros.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { CollabNode, EditorDocumentSnapshot } from "../../../shared/collab.js";
import type { EditorNode, Flow } from "../canvas/flows.js";
import {
  editorSnapshotHasUserContent,
  editorSnapshotsEqual,
  snapshotFromWorkingState,
  workingStateFromSnapshot,
} from "./editor-document.js";

function def(id: string, x = 0): NodeData {
  return {
    id,
    type: "const-number",
    title: "Number",
    subtitle: "",
    icon: "const",
    x,
    y: 0,
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "num", editable: true }],
    values: { out: 1 },
  };
}

function rw(id: string, x = 0, selected = false): EditorNode {
  return {
    id,
    type: "rw",
    selected,
    position: { x, y: 0 },
    dragHandle: ".rw-drag",
    data: { def: def(id, x) },
  } as EditorNode;
}

function comment(id: string, selected = false): EditorNode {
  return {
    id,
    type: "comment",
    selected,
    position: { x: 5, y: 6 },
    data: { title: "Area", color: "blue", w: 200, h: 120 },
  } as EditorNode;
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, sourceHandle: "out", targetHandle: "in", animated: true };
}

function flow(id: string, nodes: EditorNode[] = [], edges: Edge[] = []): Flow {
  return { id, name: id, nodes, edges };
}

function collabSnapshot(flows: EditorDocumentSnapshot["flows"], activeFlowId?: string): EditorDocumentSnapshot {
  const first = flows[0]?.id;
  return { version: 1, activeFlowId, flows, macros: {}, settings: { autoDeploy: false, deployFlowId: first, deployedFlowIds: first ? [first] : [] } };
}

describe("editor document adapter", () => {
  it("stashes the active working copy without making the active tab the deployment target", () => {
    const inactiveNode = rw("old");
    const activeNode = rw("active", 42);
    const activeEdge = edge("e1", "active", "other");

    const snapshot = snapshotFromWorkingState({
      flows: [flow("inactive", [inactiveNode]), flow("active", [rw("stale")])],
      activeFlowId: "active",
      activeNodes: [activeNode],
      activeEdges: [activeEdge],
      macros: {},
      autoDeploy: true,
      deployedFlowIds: ["inactive"],
    });

    expect(snapshot.flows.find((f) => f.id === "inactive")?.nodes.map((n) => n.id)).toEqual(["old"]);
    expect(snapshot.flows.find((f) => f.id === "active")?.nodes.map((n) => n.id)).toEqual(["active"]);
    expect(snapshot.flows.find((f) => f.id === "active")?.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(snapshot.activeFlowId).toBe("inactive");
    expect(snapshot.settings).toEqual({ autoDeploy: true, deployFlowId: "inactive", deployedFlowIds: ["inactive"] });
  });

  it("strips selected state from collaborative nodes", () => {
    const snapshot = snapshotFromWorkingState({
      flows: [flow("flow", [])],
      activeFlowId: "flow",
      activeNodes: [rw("n1", 0, true), comment("c1", true)],
      activeEdges: [],
      macros: {},
      autoDeploy: false,
      deployedFlowIds: ["flow"],
    });

    expect(snapshot.flows[0]!.nodes.every((n) => !("selected" in n))).toBe(true);
  });

  it("filters missing deployment flows while keeping a legacy first-flow fallback", () => {
    const snapshot = snapshotFromWorkingState({
      flows: [flow("first")],
      activeFlowId: "missing",
      activeNodes: [rw("ignored")],
      activeEdges: [],
      macros: {},
      autoDeploy: false,
      deployedFlowIds: ["missing"],
    });

    expect(snapshot.settings.deployFlowId).toBe("first");
    expect(snapshot.settings.deployedFlowIds).toEqual([]);
  });

  it("preserves the previous local active flow when applying a remote snapshot", () => {
    const snapshot = collabSnapshot([
      { id: "remote", name: "Remote", nodes: [rw("r") as unknown as CollabNode], edges: [] },
      { id: "local", name: "Local", nodes: [rw("l") as unknown as CollabNode], edges: [] },
    ], "remote");

    const applied = workingStateFromSnapshot(snapshot, "local");

    expect(applied.activeFlowId).toBe("local");
    expect(applied.activeNodes.map((n) => n.id)).toEqual(["l"]);
  });

  it("falls back to snapshot activeFlowId, then first flow, when local active flow disappeared", () => {
    const withSnapshotActive = collabSnapshot([
      { id: "first", name: "First", nodes: [rw("f") as unknown as CollabNode], edges: [] },
      { id: "snapshot-active", name: "Active", nodes: [rw("a") as unknown as CollabNode], edges: [] },
    ], "snapshot-active");
    expect(workingStateFromSnapshot(withSnapshotActive, "deleted").activeFlowId).toBe("snapshot-active");

    const withInvalidSnapshotActive = collabSnapshot([
      { id: "first", name: "First", nodes: [rw("f") as unknown as CollabNode], edges: [] },
    ], "also-deleted");
    expect(workingStateFromSnapshot(withInvalidSnapshotActive, "deleted").activeFlowId).toBe("first");
  });

  it("restores macros and deployment settings from the snapshot", () => {
    const macros: MacroMap = {
      m1: { id: "m1", name: "Macro", inputs: [], outputs: [], nodes: [], edges: [], stateful: false },
    };
    const snapshot: EditorDocumentSnapshot = {
      version: 1,
      activeFlowId: "flow",
      flows: [{ id: "flow", name: "Flow", nodes: [], edges: [] }],
      macros,
      settings: { autoDeploy: true, deployFlowId: "flow", deployedFlowIds: ["flow"] },
    };

    expect(workingStateFromSnapshot(snapshot, "flow")).toMatchObject({ macros, autoDeploy: true, deployedFlowIds: ["flow"] });
  });

  it("structurally shares unchanged flows, nodes, and edges across remote snapshots", () => {
    const first = collabSnapshot([
      { id: "a", name: "A", nodes: [rw("a1") as unknown as CollabNode], edges: [] },
      { id: "b", name: "B", nodes: [rw("b1") as unknown as CollabNode, rw("b2") as unknown as CollabNode], edges: [] },
    ], "a");
    const previous = workingStateFromSnapshot(first, "a");
    const changed = structuredClone(first);
    const changedNode = changed.flows[1]!.nodes[1]!;
    changedNode.position = { x: 20, y: 0 };
    ((changedNode.data as { def: NodeData }).def).x = 20;

    const applied = workingStateFromSnapshot(changed, "a", previous);

    expect(applied.flows[0]).toBe(previous.flows[0]);
    expect(applied.activeNodes).toBe(previous.activeNodes);
    expect(applied.flows[1]!.nodes[0]).toBe(previous.flows[1]!.nodes[0]);
    expect(applied.flows[1]!.nodes[1]).not.toBe(previous.flows[1]!.nodes[1]);
  });

  it("keeps current JSON snapshot equality semantics", () => {
    const snapshot = snapshotFromWorkingState({ flows: [flow("flow")], activeFlowId: "flow", activeNodes: [], activeEdges: [], macros: {}, autoDeploy: false, deployedFlowIds: ["flow"] });

    expect(editorSnapshotsEqual(null, snapshot)).toBe(false);
    expect(editorSnapshotsEqual(snapshot, JSON.parse(JSON.stringify(snapshot)) as EditorDocumentSnapshot)).toBe(true);
  });

  it("detects whether a local snapshot has user content", () => {
    const empty = snapshotFromWorkingState({ flows: [{ id: "flow-1", name: "Flow 1", nodes: [], edges: [] }], activeFlowId: "flow-1", activeNodes: [], activeEdges: [], macros: {}, autoDeploy: false, deployedFlowIds: ["flow-1"] });
    const nonEmpty = snapshotFromWorkingState({ flows: [flow("flow")], activeFlowId: "flow", activeNodes: [rw("n")], activeEdges: [], macros: {}, autoDeploy: false, deployedFlowIds: ["flow"] });

    expect(editorSnapshotHasUserContent(empty)).toBe(false);
    expect(editorSnapshotHasUserContent(nonEmpty)).toBe(true);
  });
});
