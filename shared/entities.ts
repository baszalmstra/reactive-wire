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

/** A versioned, immutable view of the server-owned canonical entity map. */
export interface EntitySnapshot {
  version: number;
  entities: Readonly<EntityMap>;
}

/** Ordered changes published by an entity adapter. */
export type EntityUpdate =
  | { kind: "full"; version: number; entities: Readonly<EntityMap> }
  | { kind: "delta"; version: number; changed: EntityMap; removed: string[] };
