import {
  callService as haCallService,
  createConnection,
  createLongLivedTokenAuth,
  getConfig,
  getStates,
  type Auth,
  type Connection,
  type StateChangedEvent,
} from "home-assistant-js-websocket";
import type { EntityMap, EntityUpdate } from "../../shared/entities.js";
import { isHomeLocation, type HomeLocation } from "../../shared/home.js";
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

type CoreConfigUpdatedEvent = {
  event_type: "core_config_updated";
  data: Record<string, unknown>;
};

export class RealHA implements HAClient, EntityFeed {
  private latest: EntityMap = Object.create(null) as EntityMap;
  /** Full-precision ordering metadata is deliberately separate from millisecond UI values. */
  private latestUpdated = new Map<string, InstantOrderKey>();
  private readonly listeners = new Set<(update: EntityUpdate) => void>();
  private readonly connectionListeners = new Set<(status: HAConnectionStatus) => void>();
  private readonly locationListeners = new Set<(location: HomeLocation | null) => void>();
  private readonly subscriptions: Array<() => Promise<void>> = [];
  private version = 0;
  private syncing = true;
  private buffered: StateChangedEvent[] = [];
  private bufferOverflowed = false;
  private transportReady = false;
  private syncGeneration = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveRetryWait: (() => void) | null = null;
  private status: HAConnectionStatus = { phase: "disconnected", epoch: 0, snapshotVersion: null };
  private location: HomeLocation | null = null;
  private stopped = false;
  private readonly onDisconnected = () => this.markDisconnected();
  private readonly onReady = () => { void this.markReadyAndSynchronize(); };

  private constructor(private readonly connection: Connection) {}

  static async connect(url: string, token: string): Promise<RealHA> {
    const auth = authFor(url, token);
    const connection = await createConnection({ auth });
    const ha = new RealHA(connection);
    // Install lifecycle listeners and both event subscriptions before any config/state command.
    // A transient getConfig failure then belongs to the same recoverable synchronization loop as
    // getStates instead of rejecting an otherwise healthy connection before reconnect handling.
    connection.addEventListener("disconnected", ha.onDisconnected);
    connection.addEventListener("ready", ha.onReady);
    try {
      const unsubscribeStates = await connection.subscribeEvents<StateChangedEvent>((event) => ha.receive(event), "state_changed");
      ha.subscriptions.push(unsubscribeStates);
      const unsubscribeConfig = await connection.subscribeEvents<CoreConfigUpdatedEvent>(() => ha.configurationChanged(), "core_config_updated");
      ha.subscriptions.push(unsubscribeConfig);
      ha.transportReady = true;
      await ha.beginSynchronization();
      return ha;
    } catch (error) {
      ha.stop();
      throw error;
    }
  }

  homeLocation(): HomeLocation | null {
    return this.location ? { ...this.location } : null;
  }

  onLocation(cb: (location: HomeLocation | null) => void): () => void {
    this.locationListeners.add(cb);
    return () => this.locationListeners.delete(cb);
  }

  async callService(call: ServiceCall): Promise<void> {
    if (this.stopped || this.status.phase !== "ready") throw new Error(`Home Assistant is ${this.stopped ? "stopped" : this.status.phase}`);
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

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.transportReady = false;
    this.status = { phase: "disconnected", epoch: this.status.epoch, snapshotVersion: null };
    this.syncGeneration += 1;
    this.cancelRetryWait();
    for (const unsubscribe of this.subscriptions.splice(0)) {
      try {
        // The HA library rejects unsubscribe promises when its transport is already closing.
        // Attach the handler before close() below can trigger that rejection.
        void unsubscribe().catch(() => {});
      } catch {
        // A cleanup callback may also throw before returning its promise. Keep releasing the
        // remaining listeners and transport resources synchronously.
      }
    }
    this.connection.removeEventListener("disconnected", this.onDisconnected);
    this.connection.removeEventListener("ready", this.onReady);
    this.listeners.clear();
    this.locationListeners.clear();
    this.connectionListeners.clear();
    this.connection.close();
  }

  private emit(update: EntityUpdate): void {
    this.listeners.forEach((cb) => cb(update));
  }

  private emitConnection(status: HAConnectionStatus): void {
    this.status = status;
    const snapshot = this.connectionStatus();
    this.connectionListeners.forEach((cb) => cb(snapshot));
  }

  private emitLocation(location: HomeLocation): void {
    this.location = { ...location };
    const snapshot = this.homeLocation();
    this.locationListeners.forEach((cb) => cb(snapshot));
  }

  private configurationChanged(): void {
    if (this.stopped || !this.transportReady) return;
    void this.beginSynchronization();
  }

  private cancelRetryWait(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.resolveRetryWait?.();
    this.resolveRetryWait = null;
  }

  private markDisconnected(): void {
    if (this.stopped) return;
    this.transportReady = false;
    this.syncGeneration += 1;
    this.cancelRetryWait();
    this.syncing = true;
    this.buffered = [];
    this.bufferOverflowed = false;
    this.emitConnection({ phase: "disconnected", epoch: this.status.epoch, snapshotVersion: null });
  }

  private async markReadyAndSynchronize(): Promise<void> {
    if (this.stopped) return;
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
    if (this.stopped) return;
    const epoch = this.status.epoch + 1;
    const generation = ++this.syncGeneration;
    this.cancelRetryWait();
    this.syncing = true;
    this.buffered = [];
    this.bufferOverflowed = false;
    this.emitConnection({ phase: "syncing", epoch, snapshotVersion: null });
    let attempt = 0;
    while (generation === this.syncGeneration && this.transportReady) {
      try {
        const complete = await this.synchronize(generation, epoch);
        if (complete) return;
      } catch {
        // The transport can stay connected after a command-level config/state failure. Retry below.
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

  /** Fetch and atomically install authoritative config plus full state for one synchronization epoch. */
  private async synchronize(generation: number, epoch: number): Promise<boolean> {
    const [config, states] = await Promise.all([getConfig(this.connection), getStates(this.connection)]);
    const location: HomeLocation = {
      latitude: config.latitude,
      longitude: config.longitude,
      elevation: config.elevation,
      timeZone: config.time_zone,
    };
    if (!isHomeLocation(location)) throw new Error("Home Assistant returned an invalid home location");
    if (generation !== this.syncGeneration || !this.transportReady || this.stopped) return true;
    // Once events were dropped, this response cannot prove freshness. Start a later full request.
    if (this.bufferOverflowed) return false;
    this.latest = entityMapFromStates(states);
    this.latestUpdated = new Map(
      states.flatMap((state) => {
        const order = instantOrderKey(state.last_updated);
        return order ? [[state.entity_id, order] as const] : [];
      }),
    );
    // Install both snapshots while status is still syncing. Consumers cannot actuate or evaluate
    // this epoch until the subsequent ready frame, but location/feed subscribers already observe
    // one coherent authoritative replacement.
    this.emitLocation(location);
    const fullVersion = ++this.version;
    this.emit({ kind: "full", version: fullVersion, entities: this.latest });
    const buffered = this.buffered;
    this.buffered = [];
    this.syncing = false;
    for (const event of buffered) if (this.eventIsNewer(event)) this.applyEvent(event);
    if (generation === this.syncGeneration && this.transportReady && !this.stopped) {
      this.emitConnection({ phase: "ready", epoch, snapshotVersion: this.version });
    }
    return true;
  }
}
