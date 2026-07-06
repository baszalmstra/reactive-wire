import { type EntityFeed, type EntityState, type HAClient, type ServiceCall } from "./client.js";

/**
 * An in-memory Home Assistant stand-in. Entity changes drive the reactive graph;
 * service calls are recorded rather than executed so tests can assert on them.
 */
export class MockHA implements HAClient, EntityFeed {
  private readonly entities = new Map<string, EntityState>();
  private readonly listeners = new Set<() => void>();
  readonly calls: ServiceCall[] = [];

  callService(call: ServiceCall): void {
    this.calls.push(call);
  }

  entitiesSnapshot(): Record<string, EntityState> {
    return Object.fromEntries(this.entities);
  }

  onEntities(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Set an entity's state and attributes, as if Home Assistant reported a change. */
  setState(entityId: string, state: string, attributes: Record<string, unknown> = {}): void {
    this.entities.set(entityId, { state, attributes });
    this.listeners.forEach((cb) => cb());
  }

  /** Remove an entity entirely, as if it were deleted from Home Assistant. */
  remove(entityId: string): void {
    this.entities.delete(entityId);
    this.listeners.forEach((cb) => cb());
  }

  /** The most recent service call, or undefined if none have been made. */
  lastCall(): ServiceCall | undefined {
    return this.calls[this.calls.length - 1];
  }
}
