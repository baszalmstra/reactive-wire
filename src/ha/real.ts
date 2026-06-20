import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as haCallService,
  type Connection,
  type HassEntities,
  type HassEntity,
} from "home-assistant-js-websocket";
import { cell, type Cell } from "../reactive.js";
import { ok, unavailable, type Value } from "../value.js";
import { type EntityFeed, type EntityState, type HAClient, type ServiceCall } from "./client.js";

/**
 * A live connection to Home Assistant. Entity updates from the WebSocket feed drive
 * the reactive graph; service calls are sent over the same connection.
 *
 * Requires a global WebSocket implementation, which Node provides natively from v21.
 */
export class RealHA implements HAClient, EntityFeed {
  private readonly entities = new Map<string, Cell<Value<EntityState>>>();
  private readonly lastRaw = new Map<string, HassEntity>();
  private readonly latest = new Map<string, EntityState>();
  private readonly listeners = new Set<() => void>();

  private constructor(private readonly connection: Connection) {}

  static async connect(url: string, token: string): Promise<RealHA> {
    const auth = createLongLivedTokenAuth(url, token);
    const connection = await createConnection({ auth });
    const ha = new RealHA(connection);
    subscribeEntities(connection, (entities) => ha.apply(entities));
    return ha;
  }

  private cellFor(entityId: string): Cell<Value<EntityState>> {
    let c = this.entities.get(entityId);
    if (!c) {
      c = cell<Value<EntityState>>(ok({ entity_id: entityId, state: "unavailable", attributes: {} }));
      this.entities.set(entityId, c);
    }
    return c;
  }

  async callService(call: ServiceCall): Promise<void> {
    await haCallService(this.connection, call.domain, call.service, call.data, call.target);
  }

  entitiesSnapshot(): Record<string, EntityState> {
    return Object.fromEntries(this.latest);
  }

  onEntities(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Apply a merged-state snapshot, updating only entities whose data actually changed. */
  private apply(entities: HassEntities): void {
    let changed = false;
    for (const entityId of Array.from(this.latest.keys())) {
      if (Object.prototype.hasOwnProperty.call(entities, entityId)) continue;
      changed = true;
      this.latest.delete(entityId);
      this.lastRaw.delete(entityId);
      this.entities.get(entityId)?.set(unavailable());
    }
    for (const [entityId, raw] of Object.entries(entities)) {
      if (this.lastRaw.get(entityId) === raw) continue;
      changed = true;
      this.lastRaw.set(entityId, raw);
      // Home Assistant reports change/update times as ISO strings; convert to epoch
      // milliseconds so duration math (now - last_changed) works on plain numbers.
      const lc = Date.parse(raw.last_changed);
      const lu = Date.parse(raw.last_updated);
      const state: EntityState = {
        entity_id: entityId,
        state: raw.state,
        attributes: raw.attributes,
        ...(Number.isFinite(lc) ? { last_changed: lc } : {}),
        ...(Number.isFinite(lu) ? { last_updated: lu } : {}),
      };
      this.latest.set(entityId, state);
      this.cellFor(entityId).set(ok(state));
    }
    if (changed) this.listeners.forEach((cb) => cb());
  }
}
