/** A snapshot of one Home Assistant entity. */
export interface EntityState {
  readonly entity_id: string;
  readonly state: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  /** Epoch milliseconds when the state last changed, if Home Assistant reported it. */
  readonly last_changed?: number;
  /** Epoch milliseconds when the entity was last updated, if Home Assistant reported it. */
  readonly last_updated?: number;
}

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
