import { describe, expect, it } from "vitest";
import type { CollabNode, EditorDocumentSnapshot } from "../shared/collab.js";
import type { NodeData } from "../shared/node-types.js";
import { AutoDeployController, graphFromEditorSnapshot } from "../src/server/collab-deploy-adapter.js";
import type { DeployRequest } from "../src/server/deploy-validation.js";

function def(id: string): NodeData {
  return {
    id,
    type: "const-number",
    title: "Number",
    subtitle: "",
    icon: "const",
    x: 0,
    y: 0,
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "num", editable: true }],
  };
}

function rw(id: string): CollabNode {
  return { id, type: "rw", position: { x: 0, y: 0 }, data: { def: def(id) } };
}

function comment(id: string): CollabNode {
  return { id, type: "comment", position: { x: 0, y: 0 }, data: { title: "Note", w: 100, h: 80 } };
}

function snapshot(overrides: Partial<EditorDocumentSnapshot> = {}): EditorDocumentSnapshot {
  return {
    version: 1,
    activeFlowId: "flow-a",
    flows: [
      {
        id: "flow-a",
        name: "A",
        nodes: [rw("a"), rw("b"), comment("c")],
        edges: [
          { id: "ok", source: "a", sourceHandle: "out", target: "b", targetHandle: "in" },
          { id: "dangling", source: "a", sourceHandle: "out", target: "missing", targetHandle: "in" },
          { id: "comment", source: "a", sourceHandle: "out", target: "c", targetHandle: "in" },
        ],
      },
    ],
    macros: {},
    settings: { autoDeploy: false, deployFlowId: "flow-a" },
    ...overrides,
  };
}

describe("collab deploy adapter", () => {
  it("derives a runtime graph from the selected deploy flow and filters non-runtime nodes", () => {
    const graph = graphFromEditorSnapshot(snapshot());

    expect(graph?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(graph?.edges).toEqual([{ id: "ok", from: { node: "a", pin: "out" }, to: { node: "b", pin: "in" } }]);
  });

  it("uses the configured deploy flow rather than the collaborative active flow", () => {
    const graph = graphFromEditorSnapshot(snapshot({
      activeFlowId: "flow-a",
      flows: [
        { id: "flow-a", name: "A", nodes: [rw("a")], edges: [] },
        { id: "flow-b", name: "B", nodes: [rw("b")], edges: [] },
      ],
      settings: { autoDeploy: false, deployFlowId: "flow-b" },
    }));

    expect(graph?.nodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("auto-deploys once per deploy graph signature and resets when disabled", () => {
    const deployed: DeployRequest[] = [];
    const controller = new AutoDeployController((graph) => deployed.push(graph));
    const enabled = snapshot({ settings: { autoDeploy: true, deployFlowId: "flow-a" } });

    expect(controller.maybeDeploy(enabled)).toEqual({ ok: true, unsupported: [] });
    expect(controller.maybeDeploy(enabled)).toBeUndefined();
    expect(deployed).toHaveLength(1);

    controller.maybeDeploy(snapshot({ settings: { autoDeploy: false, deployFlowId: "flow-a" } }));
    expect(controller.maybeDeploy(enabled)).toEqual({ ok: true, unsupported: [] });
    expect(deployed).toHaveLength(2);
  });
});
