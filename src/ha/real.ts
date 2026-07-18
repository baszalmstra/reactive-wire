import {
  callService as haCallService,
  createConnection,
  createLongLivedTokenAuth,
  getStates,
  type Auth,
  type Connection,
  type StateChangedEvent,
} from "home-assistant-js-websocket";
import type { EntityMap, EntityUpdate } from "../../shared/entities.js";
import { applyEntityEvent, entityMapFromStates, translateEntity } from "./apply-entities.js";
import { type EntityFeed, type HAClient, type ServiceCall } from "./client.js";

/**
 * A live connection to Home Assistant. One canonical entity record is rebuilt only for a full
 * synchronization; ordinary `state_changed` events update one key and publish a compact delta.
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
  private latest: EntityMap = Object.create(null) as EntityMap;
  private readonly listeners = new Set<(update: EntityUpdate) => void>();
  private version = 0;
  private syncing = true;
  private buffered: StateChangedEvent[] = [];
  private syncGeneration = 0;

  private constructor(private readonly connection: Connection) {}

  static async connect(url: string, token: string): Promise<RealHA> {
    const auth = authFor(url, token);
    const connection = await createConnection({ auth });
    const ha = new RealHA(connection);
    connection.addEventListener("disconnected", () => { ha.syncing = true; });
    connection.addEventListener("ready", () => { void ha.synchronize().catch(() => { /* the connection will retry */ }); });
    // Subscribe before requesting the full state so changes racing the snapshot are buffered.
    await connection.subscribeEvents<StateChangedEvent>((event) => ha.receive(event), "state_changed");
    await ha.synchronize();
    return ha;
  }

  async callService(call: ServiceCall): Promise<void> {
    await haCallService(this.connection, call.domain, call.service, call.data, call.target);
  }

  entitiesSnapshot() {
    return { version: this.version, entities: this.latest } as const;
  }

  onEntities(cb: (update: EntityUpdate) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(update: EntityUpdate): void {
    this.listeners.forEach((cb) => cb(update));
  }

  private receive(event: StateChangedEvent): void {
    if (this.syncing) {
      this.buffered.push(event);
      return;
    }
    this.applyEvent(event);
  }

  private applyEvent(event: StateChangedEvent): void {
    const applied = applyEntityEvent(this.latest, event);
    if (!applied) return;
    this.emit({ kind: "delta", version: ++this.version, ...applied });
  }

  /** Ignore a buffered event already represented by a newer full-snapshot entity. */
  private eventIsNewer(event: StateChangedEvent): boolean {
    const current = this.latest[event.data.entity_id];
    const raw = event.data.new_state ?? event.data.old_state;
    if (!current || !raw) return true;
    const eventUpdated = translateEntity(raw).last_updated;
    return eventUpdated === undefined || current.last_updated === undefined || eventUpdated > current.last_updated;
  }

  /** Fetch and install one full state after initial connection and every reconnect. */
  private async synchronize(): Promise<void> {
    const generation = ++this.syncGeneration;
    this.syncing = true;
    const states = await getStates(this.connection);
    if (generation !== this.syncGeneration) return;
    this.latest = entityMapFromStates(states);
    this.emit({ kind: "full", version: ++this.version, entities: this.latest });
    const buffered = this.buffered;
    this.buffered = [];
    this.syncing = false;
    for (const event of buffered) if (this.eventIsNewer(event)) this.applyEvent(event);
  }
}
