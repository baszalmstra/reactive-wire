import { V, UN, ER, parseEntityValue, entityStateType } from "../../value.js";
import type { ValueType } from "../../theme.js";
import type { EntityState } from "../../entities.js";
import type { NodeDef } from "../node-def.js";
import { base } from "./template-base.js";

// Seconds expressed by a duration count under a Home Assistant duration unit. HA reports these as
// 'ms', 's', 'min', 'h', or 'd'; anything unrecognized is read as seconds.
function durationUnitSeconds(count: number, unit: unknown): number {
  switch (String(unit)) {
    case "ms": return count / 1000;
    case "min": return count * 60;
    case "h": return count * 3600;
    case "d": return count * 86400;
    case "s":
    default: return count;
  }
}

/**
 * The state pin's value, typed from the entity's metadata so its type stays fixed even while the
 * state is unavailable. A duration sensor's count is converted to seconds using its declared unit.
 */
function stateValue(entityId: string, e: EntityState) {
  const type: ValueType = entityStateType(entityId, e.state, e.attributes);
  if (type === "duration") {
    const parsed = parseEntityValue(e.state, "num");
    if (parsed.status !== "ok") return UN("duration");
    return V("duration", durationUnitSeconds(parsed.v as number, e.attributes.unit_of_measurement));
  }
  return parseEntityValue(e.state, type);
}

export const entity: NodeDef = {
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
  eval: ({ n, pinId, cfg, entities }) => {
    const pin = n.outputs.find((p) => p.id === pinId);
    const entityId = String(cfg.entity_id ?? "");
    if (pin?.ghost) return ER(pin.type, `attribute '${pin.missing}' no longer exposed`);
    const e = entities[entityId];
    // The state pin's type is taken from the entity's metadata, so the unavailable status it
    // carries while the entity is missing still names the right type.
    if (pinId === "state") {
      if (!e) return UN(entityStateType(entityId, "", {}));
      return stateValue(entityId, e);
    }
    const type = pin?.type ?? "any";
    if (!e) return UN(type);
    // The change/update timestamps are surfaced as datetime instants, so subtracting one from
    // now() yields an elapsed duration. They are unavailable until the feed reports them.
    if (pinId === "last_changed") return e.last_changed == null ? UN("datetime") : V("datetime", e.last_changed);
    if (pinId === "last_updated") return e.last_updated == null ? UN("datetime") : V("datetime", e.last_updated);
    return parseEntityValue(e.attributes[pinId], type);
  },
};
