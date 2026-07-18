// The engine and the streaming feed share one entity-state shape (keyed by entity id in the
// snapshot map), so the HA layer produces that canonical type directly rather than a parallel one.
import type { EntitySnapshot, EntityState, EntityUpdate } from "../../shared/entities.js";
export type { EntitySnapshot, EntityState, EntityUpdate };

// The actuation call shape is owned by the engine, the single source of truth for what a
// sink wants to do; re-export it here so the HA layer and the engine agree on one type.
import type { ServiceCall } from "../../shared/results.js";
export type { ServiceCall };

/** The runtime's view of Home Assistant: the means to actuate an entity. */
export interface HAClient {
  /** Actuate an entity. Implementations may execute or only record the call. */
  callService(call: ServiceCall): void | Promise<void>;
}

/** A live, versioned feed backed by one canonical server-owned entity map. */
export interface EntityFeed {
  /** The current state and monotonic version. Callers must treat the returned map as immutable. */
  entitiesSnapshot(): EntitySnapshot;
  /** Subscribe to ordered full/delta updates; returns an unsubscribe function. */
  onEntities(cb: (update: EntityUpdate) => void): () => void;
}
