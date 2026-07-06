import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as haCallService,
  type Auth,
  type Connection,
  type HassEntities,
  type HassEntity,
} from "home-assistant-js-websocket";
import { applyEntities } from "./apply-entities.js";
import { type EntityFeed, type EntityState, type HAClient, type ServiceCall } from "./client.js";

/**
 * A live connection to Home Assistant. Entity updates from the WebSocket feed drive
 * the reactive graph; service calls are sent over the same connection.
 *
 * Requires a global WebSocket implementation, which Node provides natively from v21.
 */
function authFor(url: string, token: string): Auth {
  const trimmed = url.replace(/\/$/, "");
  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) return createLongLivedTokenAuth(trimmed, token);
  return {
    get wsUrl() { return trimmed; },
    get accessToken() { return token; },
    get expired() { return false; },
    refreshAccessToken: async () => {},
  } as unknown as Auth;
}

export class RealHA implements HAClient, EntityFeed {
  private latest = new Map<string, EntityState>();
  private lastRaw = new Map<string, HassEntity>();
  private readonly listeners = new Set<() => void>();

  private constructor(private readonly connection: Connection) {}

  static async connect(url: string, token: string): Promise<RealHA> {
    const auth = authFor(url, token);
    const connection = await createConnection({ auth });
    const ha = new RealHA(connection);
    subscribeEntities(connection, (entities) => ha.apply(entities));
    return ha;
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
    const next = applyEntities(this.latest, this.lastRaw, entities);
    this.latest = next.latest;
    this.lastRaw = next.lastRaw;
    if (next.changed) this.listeners.forEach((cb) => cb());
  }
}
