import { describe, expect, it } from "vitest";
import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { EntityState } from "../shared/entities.js";
import { applyEntities } from "../src/ha/apply-entities.js";

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

const empty = () => new Map<string, EntityState>();
const emptyRaw = () => new Map<string, HassEntity>();

describe("applyEntities", () => {
  it("adds a new entity and parses ISO timestamps to epoch milliseconds", () => {
    const entities: HassEntities = { "light.a": raw("light.a", "on", { attributes: { brightness: 5 } }) };
    const { latest, changed } = applyEntities(empty(), emptyRaw(), entities);

    expect(changed).toBe(true);
    expect(latest.get("light.a")).toEqual({
      state: "on",
      attributes: { brightness: 5 },
      last_changed: Date.parse("2024-01-01T00:00:00.000Z"),
      last_updated: Date.parse("2024-01-01T00:00:00.000Z"),
    });
  });

  it("does not carry an entity_id field on the produced state", () => {
    const { latest } = applyEntities(empty(), emptyRaw(), { "light.a": raw("light.a", "on") });
    expect(Object.prototype.hasOwnProperty.call(latest.get("light.a"), "entity_id")).toBe(false);
  });

  it("skips an entity whose raw object reference is unchanged", () => {
    const shared = raw("light.a", "on");
    const first = applyEntities(empty(), emptyRaw(), { "light.a": shared });
    const second = applyEntities(first.latest, first.lastRaw, { "light.a": shared });
    expect(second.changed).toBe(false);
    expect(second.latest.get("light.a")).toBe(first.latest.get("light.a"));
  });

  it("re-translates when the raw object reference changes", () => {
    const first = applyEntities(empty(), emptyRaw(), { "light.a": raw("light.a", "on") });
    const second = applyEntities(first.latest, first.lastRaw, { "light.a": raw("light.a", "off") });
    expect(second.changed).toBe(true);
    expect(second.latest.get("light.a")?.state).toBe("off");
  });

  it("drops an entity the snapshot no longer reports, so it reads as unavailable downstream", () => {
    const first = applyEntities(empty(), emptyRaw(), { "light.a": raw("light.a", "on") });
    const second = applyEntities(first.latest, first.lastRaw, {});
    expect(second.changed).toBe(true);
    expect(second.latest.has("light.a")).toBe(false);
    expect(second.lastRaw.has("light.a")).toBe(false);
  });

  it("omits timestamps that are missing or not parseable", () => {
    const entities: HassEntities = {
      "sensor.a": raw("sensor.a", "1", { last_changed: "not-a-date", last_updated: undefined as unknown as string }),
    };
    const { latest } = applyEntities(empty(), emptyRaw(), entities);
    const state = latest.get("sensor.a")!;
    expect(state.last_changed).toBeUndefined();
    expect(state.last_updated).toBeUndefined();
  });

  it("does not mutate the maps it is given", () => {
    const prevLatest = empty();
    const prevRaw = emptyRaw();
    applyEntities(prevLatest, prevRaw, { "light.a": raw("light.a", "on") });
    expect(prevLatest.size).toBe(0);
    expect(prevRaw.size).toBe(0);
  });
});
