import { describe, expect, it, vi } from "vitest";
import type { CollabNode, EditorDocumentSnapshot } from "../shared/collab.js";
import type { NodeData } from "../shared/node-types.js";
import { AutoDeployController, graphFromEditorSnapshot } from "../src/server/collab-deploy-adapter.js";
import type { DeployRequest } from "../src/server/deploy-validation.js";
import { Deployer } from "../src/server/runtime.js";
import { MockHA } from "../src/ha/mock.js";

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

/** A collab node whose def carries no input/output arrays, as an unfinished editor node can. */
function partialRw(id: string): CollabNode {
  return { id, type: "rw", position: { x: 0, y: 0 }, data: { def: { id, type: "const-number" } } };
}

/** A collab node whose def has an invalid input field the sanitizer must reject. */
function invalidRw(id: string): CollabNode {
  return { id, type: "rw", position: { x: 0, y: 0 }, data: { def: { id, type: "const-number", inputs: "nope" } } };
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

  it("auto-deploys a node whose def omits input/output arrays without crashing the runtime tick", () => {
    const ha = new MockHA();
    const deployer = new Deployer(ha, 100_000);
    const controller = new AutoDeployController((graph) => deployer.deploy(graph.nodes, graph.edges, true, graph.macros ?? {}));
    const snap = snapshot({
      flows: [{ id: "flow-a", name: "A", nodes: [partialRw("a")], edges: [] }],
      settings: { autoDeploy: true, deployFlowId: "flow-a" },
    });

    // Before the fix this def reached evaluate() with `inputs`/`outputs` undefined and threw inside
    // the deployer's run(); the sanitization gate now fills them so the deploy and tick are safe.
    expect(() => controller.maybeDeploy(snap)).not.toThrow();
    deployer.stop();
  });

  it("skips and logs an invalid def instead of deploying it", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deployed: DeployRequest[] = [];
    const controller = new AutoDeployController((graph) => deployed.push(graph));
    const snap = snapshot({
      flows: [{ id: "flow-a", name: "A", nodes: [invalidRw("a")], edges: [] }],
      settings: { autoDeploy: true, deployFlowId: "flow-a" },
    });

    const result = controller.maybeDeploy(snap);
    expect(result?.ok).toBe(false);
    expect(deployed).toHaveLength(0);
    const warnings = write.mock.calls.filter((c) => String(c[0]).includes(" warn [auto-deploy]"));
    expect(warnings).toHaveLength(1);
    write.mockRestore();
  });

  it("warns only once while a document stays invalid", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const controller = new AutoDeployController(() => {});
    const snap = snapshot({
      flows: [{ id: "flow-a", name: "A", nodes: [invalidRw("a")], edges: [] }],
      settings: { autoDeploy: true, deployFlowId: "flow-a" },
    });

    controller.maybeDeploy(snap);
    controller.maybeDeploy(snap);
    controller.maybeDeploy(snap);
    const warnings = write.mock.calls.filter((c) => String(c[0]).includes(" warn [auto-deploy]"));
    expect(warnings).toHaveLength(1);
    write.mockRestore();
  });
});
