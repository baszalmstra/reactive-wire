import { describe, expect, it } from "vitest";
import type { HassEntity, StateChangedEvent } from "home-assistant-js-websocket";
import type { EntityMap } from "../shared/entities.js";
import { applyEntityEvent, entityMapFromStates } from "../src/ha/apply-entities.js";

/** A minimal HassEntity fixture; only the fields the translation reads need to be real. */
function raw(entity_id: string, state: string, over: Partial<HassEntity> = {}): HassEntity {
  return {
    entity_id,
    state,
    attributes: {},
    last_changed: "2024-01-01T00:00:00.000Z",
    last_updated: "2024-01-01T00:00:00.000Z",
    context: { id: "c", parent_id: null, user_id: null },
    ...over,
  } as HassEntity;
}

function event(entityId: string, newState: HassEntity | null, oldState: HassEntity | null = null): StateChangedEvent {
  return {
    event_type: "state_changed",
    origin: "LOCAL",
    time_fired: "2024-01-01T00:00:00.000Z",
    context: { id: "c", parent_id: null, user_id: null },
    data: { entity_id: entityId, new_state: newState, old_state: oldState },
  };
}

describe("canonical entity updates", () => {
  it("builds a full map once and parses ISO timestamps", () => {
    const entities = entityMapFromStates([raw("light.a", "on", { attributes: { brightness: 5 } })]);
    expect(entities["light.a"]).toEqual({
      state: "on",
      attributes: { brightness: 5 },
      last_changed: Date.parse("2024-01-01T00:00:00.000Z"),
      last_updated: Date.parse("2024-01-01T00:00:00.000Z"),
    });
    expect(Object.prototype.hasOwnProperty.call(entities["light.a"], "entity_id")).toBe(false);
  });

  it("applies an add/update in place and returns only the changed entity", () => {
    const entities = entityMapFromStates([]);
    const added = applyEntityEvent(entities, event("light.a", raw("light.a", "on")));
    expect(entities["light.a"]?.state).toBe("on");
    expect(added).toEqual({ changed: { "light.a": entities["light.a"] }, removed: [] });

    const updated = applyEntityEvent(entities, event("light.a", raw("light.a", "off")));
    expect(entities["light.a"]?.state).toBe("off");
    expect(Object.keys(updated!.changed)).toEqual(["light.a"]);
  });

  it("applies a removal and treats a duplicate removal as a no-op", () => {
    const old = raw("light.a", "on");
    const entities = entityMapFromStates([old]);
    expect(applyEntityEvent(entities, event("light.a", null, old))).toEqual({ changed: {}, removed: ["light.a"] });
    expect(entities["light.a"]).toBeUndefined();
    expect(applyEntityEvent(entities, event("light.a", null, old))).toBeNull();
  });

  it("does not enumerate the full map for an individual event", () => {
    const backing = entityMapFromStates([raw("light.existing", "off")]);
    const guarded = new Proxy(backing, {
      ownKeys() { throw new Error("full entity scan"); },
    }) as EntityMap;

    expect(() => applyEntityEvent(guarded, event("light.changed", raw("light.changed", "on")))).not.toThrow();
    expect(guarded["light.changed"]?.state).toBe("on");
  });

  it("omits timestamps that are missing or invalid", () => {
    const entities = entityMapFromStates([
      raw("sensor.a", "1", { last_changed: "not-a-date", last_updated: undefined as unknown as string }),
    ]);
    expect(entities["sensor.a"]?.last_changed).toBeUndefined();
    expect(entities["sensor.a"]?.last_updated).toBeUndefined();
  });
});
