import { describe, expect, it, vi } from "vitest";
import type { EditorDocumentSnapshot } from "../shared/collab.js";
import { AutoDeployController } from "../src/server/collab-deploy-adapter.js";
import { applyStartupDeploymentPolicy } from "../src/server/startup-policy.js";

function snapshot(autoDeploy: boolean): EditorDocumentSnapshot {
  return {
    version: 1,
    activeFlowId: "flow-a",
    flows: [{ id: "flow-a", name: "A", nodes: [], edges: [] }],
    macros: {},
    settings: { autoDeploy, deployFlowId: "flow-a", deployedFlowIds: ["flow-a"] },
  };
}

describe("startup deployment policy", () => {
  it("leaves manual documents undeployed", () => {
    const maybeDeploy = vi.fn();

    expect(applyStartupDeploymentPolicy(snapshot(false), { maybeDeploy })).toEqual({ kind: "manual" });
    expect(maybeDeploy).not.toHaveBeenCalled();
  });

  it("resumes a valid persisted auto-deploy graph exactly once", () => {
    const deploy = vi.fn();
    const controller = new AutoDeployController(deploy);

    expect(applyStartupDeploymentPolicy(snapshot(true), controller)).toEqual({ kind: "resumed" });
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith({ nodes: [], edges: [], macros: {} });
  });

  it("rejects a persisted runtime node with no definition without deploying", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deploy = vi.fn();
    const controller = new AutoDeployController(deploy);
    const invalid = snapshot(true);
    invalid.flows[0]!.nodes.push({ id: "missing-def", type: "rw", position: { x: 0, y: 0 }, data: {} });

    const result = applyStartupDeploymentPolicy(invalid, controller);

    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.error).toContain("Unknown node type");
    expect(deploy).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("rejects an invalid persisted auto-deploy graph without deploying", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const deploy = vi.fn();
    const controller = new AutoDeployController(deploy);
    const invalid = snapshot(true);
    invalid.flows[0]!.nodes.push({
      id: "bad",
      type: "rw",
      position: { x: 0, y: 0 },
      data: {
        def: {
          id: "bad",
          type: "not-registered",
          title: "Bad",
          subtitle: "",
          icon: "const",
          x: 0,
          y: 0,
          inputs: [],
          outputs: [],
        },
      },
    });

    const result = applyStartupDeploymentPolicy(invalid, controller);

    expect(result.kind).toBe("rejected");
    if (result.kind === "rejected") expect(result.error).toContain("Unknown node type");
    expect(deploy).not.toHaveBeenCalled();
    write.mockRestore();
  });
});
