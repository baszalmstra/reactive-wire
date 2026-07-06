// The engine and the streaming feed share one entity-state shape (keyed by entity id in the
// snapshot map), so the HA layer produces that canonical type directly rather than a parallel one.
import type { EntityState } from "../../shared/entities.js";
export type { EntityState };

// The actuation call shape is owned by the engine, the single source of truth for what a
// sink wants to do; re-export it here so the HA layer and the engine agree on one type.
import type { ServiceCall } from "../../shared/results.js";
export type { ServiceCall };

/** The runtime's view of Home Assistant: the means to actuate an entity. */
export interface HAClient {
  /** Actuate an entity. Implementations may execute or only record the call. */
  callService(call: ServiceCall): void | Promise<void>;
}

/** A live feed of all known entity states, for streaming to editor clients. */
export interface EntityFeed {
  /** The current state of every known entity. */
  entitiesSnapshot(): Record<string, EntityState>;
  /** Subscribe to entity changes; returns an unsubscribe function. */
  onEntities(cb: () => void): () => void;
}
