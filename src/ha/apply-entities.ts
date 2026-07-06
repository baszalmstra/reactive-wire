import type { HassEntities, HassEntity } from "home-assistant-js-websocket";
import type { EntityState } from "../../shared/entities.js";

/**
 * The result of folding a Home Assistant snapshot into our entity map: the next state keyed by
 * entity id, the raw entities retained for reference-equality change detection on the next call,
 * and whether anything actually changed (so callers only notify listeners when needed).
 */
export interface AppliedEntities {
  latest: Map<string, EntityState>;
  lastRaw: Map<string, HassEntity>;
  changed: boolean;
}

/** Home Assistant reports change/update times as ISO strings; parse to epoch ms, or drop if invalid. */
function parseInstant(iso: unknown): number | undefined {
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : undefined;
}

function translate(entityId: string, raw: HassEntity): EntityState {
  const lc = parseInstant(raw.last_changed);
  const lu = parseInstant(raw.last_updated);
  return {
    state: raw.state,
    attributes: raw.attributes,
    ...(lc !== undefined ? { last_changed: lc } : {}),
    ...(lu !== undefined ? { last_updated: lu } : {}),
  };
}

/**
 * Apply a merged Home Assistant snapshot to the previous entity map, updating only entities whose
 * raw payload actually changed (compared by reference against `prevRaw`) and dropping entities the
 * snapshot no longer reports. Pure: the given maps are not mutated; fresh maps are returned.
 */
export function applyEntities(
  prevLatest: ReadonlyMap<string, EntityState>,
  prevRaw: ReadonlyMap<string, HassEntity>,
  entities: HassEntities,
): AppliedEntities {
  const latest = new Map(prevLatest);
  const lastRaw = new Map(prevRaw);
  let changed = false;

  for (const entityId of prevLatest.keys()) {
    if (Object.prototype.hasOwnProperty.call(entities, entityId)) continue;
    changed = true;
    latest.delete(entityId);
    lastRaw.delete(entityId);
  }

  for (const [entityId, raw] of Object.entries(entities)) {
    if (prevRaw.get(entityId) === raw) continue;
    changed = true;
    lastRaw.set(entityId, raw);
    latest.set(entityId, translate(entityId, raw));
  }

  return { latest, lastRaw, changed };
}
