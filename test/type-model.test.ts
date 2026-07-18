import { describe, expect, it } from "vitest";
import type { NodeData } from "../shared/node-types.js";
import type { NodeDef } from "../shared/engine/node-def.js";
import { entity } from "../shared/engine/nodes/entity.js";
import { fetch } from "../shared/engine/nodes/fetch.js";
import type { NodeConfigFor, RuntimeNode, ValuePayloadMap } from "../shared/runtime-types.js";
import { V } from "../shared/value.js";

// Compile-time contract checks. These declarations intentionally stay at module scope so the
// root typecheck verifies invalid payload/config/view combinations, not just Vitest at runtime.
const entityConfig: NodeConfigFor<"entity"> = { entity_id: "sensor.room" };
const betweenConfig: NodeConfigFor<"between"> = { includeMin: true, includeMax: false };
// @ts-expect-error Between uses include/exclude terminology for each bound
const invalidBetweenConfig: NodeConfigFor<"between"> = { minClosed: true, maxClosed: false };
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
// @ts-expect-error known runtime nodes require their typed configuration
const missingEntityRuntimeConfig: RuntimeNode<"entity"> = { id: "missing", type: "entity", inputs: [], outputs: [] };

const typedEntityNode: NodeData<"entity"> = {
  ...runtimeNode,
  title: "Room",
  subtitle: "Entity",
  icon: "bulb",
  x: 10,
  y: 20,
};
// @ts-expect-error production NodeData preserves the entity config payload type
const invalidTypedEntityNode: NodeData<"entity"> = { ...typedEntityNode, config: { entity_id: 42 } };

const typedFetchNode = fetch.template.make("fetch");
typedFetchNode.config.as = "bool";
// @ts-expect-error fetch config uses the production `as` field, not the obsolete valueType spelling
typedFetchNode.config.valueType = "bool";
// @ts-expect-error fetch value types are constrained to wire types
const invalidFetchConfig: NodeConfigFor<"fetch"> = { url: "https://example.test", as: "json" };

const entityDefinition: NodeDef<"entity"> = entity;
const fetchDefinition: NodeDef<"fetch"> = fetch;
// @ts-expect-error a real built-in definition retains its literal node kind
const wrongDefinition: NodeDef<"fetch"> = entity;

type EntityEvalConfig = Parameters<typeof entity.eval>[0]["cfg"];
// @ts-expect-error the real entity evaluator receives its typed config
const invalidEntityEvalConfig: EntityEvalConfig = { entity_id: false };

type FetchEvalConfig = Parameters<typeof fetch.eval>[0]["cfg"];
// @ts-expect-error the real fetch evaluator requires `as`
const invalidFetchEvalConfig: FetchEvalConfig = { url: "https://example.test" };

const editorNode: NodeData = {
  ...runtimeNode,
  title: "Room",
  subtitle: "Entity",
  icon: "bulb",
  x: 10,
  y: 20,
};

void betweenConfig;
void invalidBetweenConfig;
void invalidEntityConfig;
void invalidBoolPayload;
void missingEntityRuntimeConfig;
void invalidTypedEntityNode;
void invalidFetchConfig;
void entityDefinition;
void fetchDefinition;
void wrongDefinition;
void invalidEntityEvalConfig;
void invalidFetchEvalConfig;
void editorNode;

describe("runtime/editor type boundaries", () => {
  it("keeps typed payloads and runtime nodes usable at runtime", () => {
    expect(V("bool", true)).toEqual({ type: "bool", v: true, status: "ok" });
    expect(runtimeNode).not.toHaveProperty("title");
    expect(editorNode.title).toBe("Room");
  });
});
