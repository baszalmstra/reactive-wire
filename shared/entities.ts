/** A snapshot of one Home Assistant entity, as streamed by the server feed. */
export interface EntityState {
  state: string;
  attributes: Record<string, unknown>;
  /** Epoch milliseconds when this entity's state last changed, if the feed reports it. */
  last_changed?: number;
  /** Epoch milliseconds when this entity was last updated, if the feed reports it. */
  last_updated?: number;
}

/** All known entities, keyed by entity id. */
export type EntityMap = Record<string, EntityState>;
