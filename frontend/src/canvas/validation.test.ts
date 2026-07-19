import { describe, expect, it } from "vitest";
import type { Connection, Edge } from "@xyflow/react";
import { REGISTRY } from "../../../shared/engine/nodes/index.js";
import type { NodeData } from "../../../shared/node-types.js";
import { connectionReason, type RWNodeType } from "./validation.js";

function placed(def: NodeData): RWNodeType {
  return { id: def.id, type: "rw", position: { x: 0, y: 0 }, data: { def } };
}

function connection(source: string, sourceHandle: string, target: string, targetHandle: string): Connection {
  return { source, sourceHandle, target, targetHandle };
}

describe("candidate connection generic groups", () => {
  it("lets a lone generic input change concrete type when its incumbent wire is replaced", () => {
    const number = REGISTRY["const-number"]!.template.make("number");
    const duration = REGISTRY["const-duration"]!.template.make("duration");
    const target = REGISTRY.between!.template.make("between");
    const nodes = [number, duration, target].map(placed);
    const edges: Edge[] = [{
      id: "number-value",
      source: "number",
      sourceHandle: "out",
      target: "between",
      targetHandle: "value",
    }];

    expect(connectionReason(nodes, edges, connection("duration", "out", "between", "value"))).toBeNull();
  });

  it("still rejects a replacement that conflicts with a generic sibling", () => {
    const number = REGISTRY["const-number"]!.template.make("number");
    const duration = REGISTRY["const-duration"]!.template.make("duration");
    const target = REGISTRY.between!.template.make("between");
    const nodes = [number, duration, target].map(placed);
    const edges: Edge[] = [
      {
        id: "number-value",
        source: "number",
        sourceHandle: "out",
        target: "between",
        targetHandle: "value",
      },
      {
        id: "number-min",
        source: "number",
        sourceHandle: "out",
        target: "between",
        targetHandle: "min",
      },
    ];

    expect(connectionReason(nodes, edges, connection("duration", "out", "between", "value"))).toMatch(/generic group.*same concrete type/i);
  });

  it("rejects a second mismatched concrete source for Between", () => {
    const number = REGISTRY["const-number"]!.template.make("number");
    const duration = REGISTRY["const-duration"]!.template.make("duration");
    const target = REGISTRY.between!.template.make("between");
    const nodes = [number, duration, target].map(placed);
    const edges: Edge[] = [{
      id: "number-value",
      source: "number",
      sourceHandle: "out",
      target: "between",
      targetHandle: "value",
    }];

    expect(connectionReason(nodes, edges, connection("duration", "out", "between", "min"))).toMatch(/generic group.*same concrete type/i);
    expect(connectionReason(nodes, edges, connection("number", "out", "between", "min"))).toBeNull();
  });

  it("does not merge Select's independent generic pins into a type group", () => {
    const number = REGISTRY["const-number"]!.template.make("number");
    const duration = REGISTRY["const-duration"]!.template.make("duration");
    const select = REGISTRY.select!.template.make("select");
    const nodes = [number, duration, select].map(placed);
    const edges: Edge[] = [{
      id: "number-then",
      source: "number",
      sourceHandle: "out",
      target: "select",
      targetHandle: "a",
    }];

    expect(connectionReason(nodes, edges, connection("duration", "out", "select", "b"))).toBeNull();
  });
});
