import type { EntityMap, EntityUpdate } from "../../shared/entities.js";
import { type EntityFeed, type EntityState, type HAClient, type ServiceCall } from "./client.js";

/**
 * An in-memory Home Assistant stand-in. Entity changes drive the reactive graph;
 * service calls are recorded rather than executed so tests can assert on them.
 */
export class MockHA implements HAClient, EntityFeed {
  private readonly entities: EntityMap = Object.create(null) as EntityMap;
  private readonly listeners = new Set<(update: EntityUpdate) => void>();
  private version = 0;
  readonly calls: ServiceCall[] = [];

  callService(call: ServiceCall): void {
    this.calls.push(call);
  }

  entitiesSnapshot() {
    return { version: this.version, entities: this.entities } as const;
  }

  onEntities(cb: (update: EntityUpdate) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Set an entity's state and attributes, as if Home Assistant reported a change. */
  setState(entityId: string, state: string, attributes: Record<string, unknown> = {}): void {
    const entity: EntityState = { state, attributes };
    this.entities[entityId] = entity;
    const changed: EntityMap = Object.create(null) as EntityMap;
    changed[entityId] = entity;
    const update: EntityUpdate = { kind: "delta", version: ++this.version, changed, removed: [] };
    this.listeners.forEach((cb) => cb(update));
  }

  /** Remove an entity entirely, as if it were deleted from Home Assistant. */
  remove(entityId: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.entities, entityId)) return;
    delete this.entities[entityId];
    const update: EntityUpdate = {
      kind: "delta",
      version: ++this.version,
      changed: Object.create(null) as EntityMap,
      removed: [entityId],
    };
    this.listeners.forEach((cb) => cb(update));
  }

  /** The most recent service call, or undefined if none have been made. */
  lastCall(): ServiceCall | undefined {
    return this.calls[this.calls.length - 1];
  }
}
