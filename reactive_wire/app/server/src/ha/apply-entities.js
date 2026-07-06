/** Home Assistant reports change/update times as ISO strings; parse to epoch ms, or drop if invalid. */
function parseInstant(iso) {
    const ms = Date.parse(String(iso));
    return Number.isFinite(ms) ? ms : undefined;
}
function translate(entityId, raw) {
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
export function applyEntities(prevLatest, prevRaw, entities) {
    const latest = new Map(prevLatest);
    const lastRaw = new Map(prevRaw);
    let changed = false;
    for (const entityId of prevLatest.keys()) {
        if (Object.prototype.hasOwnProperty.call(entities, entityId))
            continue;
        changed = true;
        latest.delete(entityId);
        lastRaw.delete(entityId);
    }
    for (const [entityId, raw] of Object.entries(entities)) {
        if (prevRaw.get(entityId) === raw)
            continue;
        changed = true;
        lastRaw.set(entityId, raw);
        latest.set(entityId, translate(entityId, raw));
    }
    return { latest, lastRaw, changed };
}
