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
import {
  applyEntityEvent,
  compareInstantOrder,
  entityMapFromStates,
  instantOrderKey,
  type InstantOrderKey,
} from "./apply-entities.js";
import { type EntityFeed, type HAClient, type HAConnectionStatus, type ServiceCall } from "./client.js";

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

export const HA_SYNC_BUFFER_LIMIT = 512;
export const HA_SYNC_RETRY_BASE_MS = 250;
const HA_SYNC_RETRY_MAX_MS = 10_000;

export class RealHA implements HAClient, EntityFeed {
  private latest: EntityMap = Object.create(null) as EntityMap;
  /** Full-precision ordering metadata is deliberately separate from millisecond UI values. */
  private latestUpdated = new Map<string, InstantOrderKey>();
  private readonly listeners = new Set<(update: EntityUpdate) => void>();
  private readonly connectionListeners = new Set<(status: HAConnectionStatus) => void>();
  private version = 0;
  private syncing = true;
  private buffered: StateChangedEvent[] = [];
  private bufferOverflowed = false;
  private transportReady = false;
  private syncGeneration = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveRetryWait: (() => void) | null = null;
  private status: HAConnectionStatus = { phase: "disconnected", epoch: 0, snapshotVersion: null };

  private constructor(private readonly connection: Connection) {}

  static async connect(url: string, token: string): Promise<RealHA> {
    const auth = authFor(url, token);
    const connection = await createConnection({ auth });
    const ha = new RealHA(connection);
    connection.addEventListener("disconnected", () => ha.markDisconnected());
    connection.addEventListener("ready", () => { void ha.markReadyAndSynchronize(); });
    // Subscribe before requesting the full state so changes racing the snapshot are buffered.
    await connection.subscribeEvents<StateChangedEvent>((event) => ha.receive(event), "state_changed");
    ha.transportReady = true;
    await ha.beginSynchronization();
    return ha;
  }

  async callService(call: ServiceCall): Promise<void> {
    if (this.status.phase !== "ready") throw new Error(`Home Assistant is ${this.status.phase}`);
    await haCallService(this.connection, call.domain, call.service, call.data, call.target);
  }

  connectionStatus(): HAConnectionStatus {
    return { ...this.status };
  }

  onConnection(cb: (status: HAConnectionStatus) => void): () => void {
    this.connectionListeners.add(cb);
    return () => this.connectionListeners.delete(cb);
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

  private emitConnection(status: HAConnectionStatus): void {
    this.status = status;
    const snapshot = this.connectionStatus();
    this.connectionListeners.forEach((cb) => cb(snapshot));
  }

  private cancelRetryWait(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.resolveRetryWait?.();
    this.resolveRetryWait = null;
  }

  private markDisconnected(): void {
    this.transportReady = false;
    this.syncGeneration += 1;
    this.cancelRetryWait();
    this.syncing = true;
    this.buffered = [];
    this.bufferOverflowed = false;
    this.emitConnection({ phase: "disconnected", epoch: this.status.epoch, snapshotVersion: null });
  }

  private async markReadyAndSynchronize(): Promise<void> {
    this.transportReady = true;
    await this.beginSynchronization();
  }

  private retryDelay(attempt: number): Promise<void> {
    const delay = Math.min(HA_SYNC_RETRY_MAX_MS, HA_SYNC_RETRY_BASE_MS * 2 ** Math.min(attempt, 8));
    return new Promise((resolve) => {
      this.resolveRetryWait = resolve;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.resolveRetryWait = null;
        resolve();
      }, delay);
    });
  }

  private async beginSynchronization(): Promise<void> {
    const epoch = this.status.epoch + 1;
    const generation = ++this.syncGeneration;
    this.cancelRetryWait();
    this.syncing = true;
    this.emitConnection({ phase: "syncing", epoch, snapshotVersion: null });
    let attempt = 0;
    while (generation === this.syncGeneration && this.transportReady) {
      try {
        const complete = await this.synchronize(generation, epoch);
        if (complete) return;
      } catch {
        // The transport can stay connected after a command-level getStates failure. Retry below.
      }
      if (generation !== this.syncGeneration || !this.transportReady) return;
      // If the buffer overflowed during a failed attempt, the next full state is the new baseline.
      if (this.bufferOverflowed) {
        this.buffered = [];
        this.bufferOverflowed = false;
      }
      await this.retryDelay(attempt++);
    }
  }

  private receive(event: StateChangedEvent): void {
    if (this.syncing) {
      if (this.buffered.length >= HA_SYNC_BUFFER_LIMIT) {
        this.buffered = [];
        this.bufferOverflowed = true;
      } else if (!this.bufferOverflowed) {
        this.buffered.push(event);
      }
      return;
    }
    this.applyEvent(event);
  }

  /**
   * HA state timestamps order add/update events, but a deletion has no new state. Its old state's
   * last_updated describes the removed value rather than the removal, so use the event timestamp.
   */
  private eventOrder(event: StateChangedEvent): InstantOrderKey | undefined {
    return event.data.new_state === null
      ? instantOrderKey(event.time_fired)
      : instantOrderKey(event.data.new_state?.last_updated);
  }

  private applyEvent(event: StateChangedEvent): void {
    const applied = applyEntityEvent(this.latest, event);
    if (!applied) return;
    const order = this.eventOrder(event);
    if (order) this.latestUpdated.set(event.data.entity_id, order);
    this.emit({ kind: "delta", version: ++this.version, ...applied });
  }

  /** Ignore a buffered event already represented by the full snapshot or a newer buffered event. */
  private eventIsNewer(event: StateChangedEvent): boolean {
    const eventUpdated = this.eventOrder(event);
    const currentUpdated = this.latestUpdated.get(event.data.entity_id);
    return !eventUpdated || !currentUpdated || compareInstantOrder(eventUpdated, currentUpdated) > 0;
  }

  /** Fetch and install one full state after initial connection and every reconnect. */
  private async synchronize(generation: number, epoch: number): Promise<boolean> {
    const states = await getStates(this.connection);
    if (generation !== this.syncGeneration || !this.transportReady) return true;
    // Once events were dropped, this response cannot prove freshness. Start a later full request.
    if (this.bufferOverflowed) return false;
    this.latest = entityMapFromStates(states);
    this.latestUpdated = new Map(
      states.flatMap((state) => {
        const order = instantOrderKey(state.last_updated);
        return order ? [[state.entity_id, order] as const] : [];
      }),
    );
    const fullVersion = ++this.version;
    this.emit({ kind: "full", version: fullVersion, entities: this.latest });
    const buffered = this.buffered;
    this.buffered = [];
    this.syncing = false;
    for (const event of buffered) if (this.eventIsNewer(event)) this.applyEvent(event);
    if (generation === this.syncGeneration && this.transportReady) {
      this.emitConnection({ phase: "ready", epoch, snapshotVersion: this.version });
    }
    return true;
  }
}
