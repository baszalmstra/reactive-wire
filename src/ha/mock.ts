import type { EntityMap, EntityUpdate } from "../../shared/entities.js";
import { DEMO_HOME_LOCATION, type HomeLocation } from "../../shared/home.js";
import { type EntityFeed, type EntityState, type HAClient, type HAConnectionStatus, type ServiceCall } from "./client.js";

/**
 * An in-memory Home Assistant stand-in. Entity changes drive the reactive graph;
 * service calls are recorded rather than executed so tests can assert on them.
 */
export class MockHA implements HAClient, EntityFeed {
  private readonly entities: EntityMap = Object.create(null) as EntityMap;
  private readonly listeners = new Set<(update: EntityUpdate) => void>();
  private readonly connectionListeners = new Set<(status: HAConnectionStatus) => void>();
  private readonly locationListeners = new Set<(location: HomeLocation | null) => void>();
  private version = 0;
  private status: HAConnectionStatus = { phase: "ready", epoch: 1, snapshotVersion: 0 };
  readonly calls: ServiceCall[] = [];

  constructor(private location: HomeLocation | null = DEMO_HOME_LOCATION) {}

  homeLocation(): HomeLocation | null {
    return this.location ? { ...this.location } : null;
  }

  onLocation(cb: (location: HomeLocation | null) => void): () => void {
    this.locationListeners.add(cb);
    return () => this.locationListeners.delete(cb);
  }

  /** Replace Home Assistant's authoritative location, including a missing/unavailable snapshot. */
  setHomeLocation(location: HomeLocation | null): void {
    this.location = location ? { ...location } : null;
    const snapshot = this.homeLocation();
    this.locationListeners.forEach((cb) => cb(snapshot));
  }

  callService(call: ServiceCall): void {
    if (this.status.phase !== "ready") throw new Error(`Home Assistant is ${this.status.phase}`);
    this.calls.push(call);
  }

  connectionStatus(): HAConnectionStatus {
    return { ...this.status };
  }

  onConnection(cb: (status: HAConnectionStatus) => void): () => void {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
  }

  private setConnection(status: HAConnectionStatus): void {
    this.status = status;
    const snapshot = this.connectionStatus();
    this.connectionListeners.forEach((cb) => cb(snapshot));
  }

  /** Simulate transport loss. Last-known entities remain readable but cannot be actuated. */
  disconnect(): void {
    this.setConnection({ phase: "disconnected", epoch: this.status.epoch, snapshotVersion: null });
  }

  /** Simulate a new transport that has not installed its full entity snapshot yet. */
  beginReconnect(): void {
    this.setConnection({ phase: "syncing", epoch: this.status.epoch + 1, snapshotVersion: null });
  }

  /** Install the reconnect snapshot, publish it first, then mark this epoch ready. */
  completeReconnect(next?: EntityMap): void {
    if (this.status.phase === "disconnected") this.beginReconnect();
    if (next) {
      for (const id of Object.keys(this.entities)) delete this.entities[id];
      for (const [id, entity] of Object.entries(next)) this.entities[id] = entity;
    }
    const version = ++this.version;
    this.listeners.forEach((cb) => cb({ kind: "full", version, entities: this.entities }));
    this.setConnection({ phase: "ready", epoch: this.status.epoch, snapshotVersion: version });
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
    if (this.status.phase !== "ready") return;
    const update: EntityUpdate = { kind: "delta", version: ++this.version, changed, removed: [] };
    this.listeners.forEach((cb) => cb(update));
  }

  /** Remove an entity entirely, as if it were deleted from Home Assistant. */
  remove(entityId: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.entities, entityId)) return;
    delete this.entities[entityId];
    if (this.status.phase !== "ready") return;
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
