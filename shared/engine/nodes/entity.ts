import { durationSeconds } from "../../duration.js";
import { V, UN, ER, parseEntityValue, entityStateType } from "../../value.js";
import type { ValueType } from "../../theme.js";
import type { EntityState } from "../../entities.js";
import type { NodeDef } from "../node-def.js";
import { createRecord, setOwn } from "../../record.js";
import { base } from "./template-base.js";

/**
 * The state pin's value, typed from the entity's metadata so its type stays fixed even while the
 * state is unavailable. A duration sensor's count is converted to seconds using its declared unit.
 */
function stateValue(entityId: string, e: EntityState) {
  const type: ValueType = entityStateType(entityId, e.state, e.attributes);
  if (type === "duration") {
    const parsed = parseEntityValue(e.state, "num");
    if (parsed.status !== "ok") return UN("duration");
    return V("duration", durationSeconds(parsed.v as number, e.attributes.unit_of_measurement));
  }
  return parseEntityValue(e.state, type);
}

export const entity: NodeDef<"entity"> = {
  type: "entity",
  description: "Reads a Home Assistant entity; its state and each attribute become typed outputs.",
  template: {
    type: "entity", category: "Entities", label: "Entity", icon: "bulb",
    requires: { field: "entity_id", kind: "entity", label: "Entity" },
    make: (id) => base(id, {
      type: "entity", title: "entity", subtitle: "Entity", icon: "bulb", w: 214,
      config: { entity_id: "" },
      inputs: [],
      outputs: [
        { id: "state", label: "state", type: "str" },
        { id: "last_changed", label: "last changed", type: "datetime" },
      ],
    }),
  },
  eval: ({ n, cfg, entities }) => {
    const outputs = createRecord<ReturnType<typeof UN>>();
    const entityId = String(cfg.entity_id ?? "");
    const e = entities[entityId];
    // Capture every declared output from this one entity-map snapshot.
    for (const pin of n.outputs) {
      let value;
      if (pin.ghost) value = ER(pin.type, `attribute '${pin.missing}' no longer exposed`);
      else if (pin.id === "state") value = e ? stateValue(entityId, e) : UN(entityStateType(entityId, "", {}));
      else if (!e) value = UN(pin.type);
      else if (pin.id === "last_changed") value = e.last_changed == null ? UN("datetime") : V("datetime", e.last_changed);
      else if (pin.id === "last_updated") value = e.last_updated == null ? UN("datetime") : V("datetime", e.last_updated);
      else value = parseEntityValue(e.attributes[pin.id], pin.type);
      setOwn(outputs, pin.id, value);
    }
    return { outputs };
  },
};
