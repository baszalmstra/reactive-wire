import { describe, expect, it } from "vitest";
import type { NodeData } from "../shared/node-types.js";
import type { NodeConfigFor, RuntimeNode, ValuePayloadMap } from "../shared/runtime-types.js";
import { V } from "../shared/value.js";

// Compile-time contract checks. These declarations intentionally stay at module scope so the
// root typecheck verifies invalid payload/config/view combinations, not just Vitest at runtime.
const entityConfig: NodeConfigFor<"entity"> = { entity_id: "sensor.room" };
// @ts-expect-error entity runtime config requires a stable entity id
const invalidEntityConfig: NodeConfigFor<"entity"> = {};
const boolPayload: ValuePayloadMap["bool"] = true;
// @ts-expect-error a bool wire cannot carry a string
const invalidBoolPayload: ValuePayloadMap["bool"] = "false";
V("bool", boolPayload);
// @ts-expect-error typed value constructors reject mismatched literal payloads
V("bool", "false");

const runtimeNode: RuntimeNode<"entity"> = {
  id: "entity",
  type: "entity",
  inputs: [],
  outputs: [{ id: "state", label: "state", type: "str" }],
  config: entityConfig,
};
// @ts-expect-error canvas titles are not part of the runtime/deployment model
runtimeNode.title;

const editorNode: NodeData = {
  ...runtimeNode,
  title: "Room",
  subtitle: "Entity",
  icon: "bulb",
  x: 10,
  y: 20,
};

void invalidEntityConfig;
void invalidBoolPayload;
void editorNode;

describe("runtime/editor type boundaries", () => {
  it("keeps typed payloads and runtime nodes usable at runtime", () => {
    expect(V("bool", true)).toEqual({ type: "bool", v: true, status: "ok" });
    expect(runtimeNode).not.toHaveProperty("title");
    expect(editorNode.title).toBe("Room");
  });
});
