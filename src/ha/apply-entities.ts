import type { HassEntity, StateChangedEvent } from "home-assistant-js-websocket";
import type { EntityMap, EntityState } from "../../shared/entities.js";

/** Home Assistant reports change/update times as ISO strings; parse to epoch ms, or drop if invalid. */
function parseInstant(iso: unknown): number | undefined {
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : undefined;
}

/** Translate one HA state without retaining the HA client's mutable transport object. */
export function translateEntity(raw: HassEntity): EntityState {
  const lc = parseInstant(raw.last_changed);
  const lu = parseInstant(raw.last_updated);
  return {
    state: raw.state,
    attributes: raw.attributes,
    ...(lc !== undefined ? { last_changed: lc } : {}),
    ...(lu !== undefined ? { last_updated: lu } : {}),
  };
}

/** Build a canonical full state once during initial synchronization or reconnect. */
export function entityMapFromStates(states: readonly HassEntity[]): EntityMap {
  const entities: EntityMap = Object.create(null) as EntityMap;
  for (const raw of states) entities[raw.entity_id] = translateEntity(raw);
  return entities;
}

export interface AppliedEntityEvent {
  changed: EntityMap;
  removed: string[];
}

/**
 * Apply exactly one `state_changed` event to the canonical map in O(1). The map is deliberately
 * mutated in place: it is server-owned and exposed only as a read-only snapshot. Returning the
 * compact delta lets the feed avoid cloning or scanning all H entities for an individual change.
 */
export function applyEntityEvent(entities: EntityMap, event: StateChangedEvent): AppliedEntityEvent | null {
  const entityId = event.data.entity_id;
  if (!entityId) return null;
  if (event.data.new_state === null) {
    if (!Object.prototype.hasOwnProperty.call(entities, entityId)) return null;
    delete entities[entityId];
    return { changed: Object.create(null) as EntityMap, removed: [entityId] };
  }
  const state = translateEntity(event.data.new_state);
  entities[entityId] = state;
  const changed: EntityMap = Object.create(null) as EntityMap;
  changed[entityId] = state;
  return { changed, removed: [] };
}
