import { createConnection, createLongLivedTokenAuth, subscribeEntities, callService as haCallService, } from "home-assistant-js-websocket";
import { applyEntities } from "./apply-entities.js";
import {} from "./client.js";
/**
 * A live connection to Home Assistant. Entity updates from the WebSocket feed drive
 * the reactive graph; service calls are sent over the same connection.
 *
 * Requires a global WebSocket implementation, which Node provides natively from v21.
 */
function authFor(url, token) {
    const trimmed = url.replace(/\/$/, "");
    if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://"))
        return createLongLivedTokenAuth(trimmed, token);
    return {
        get wsUrl() { return trimmed; },
        get accessToken() { return token; },
        get expired() { return false; },
        refreshAccessToken: async () => { },
    };
}
export class RealHA {
    connection;
    latest = new Map();
    lastRaw = new Map();
    listeners = new Set();
    constructor(connection) {
        this.connection = connection;
    }
    static async connect(url, token) {
        const auth = authFor(url, token);
        const connection = await createConnection({ auth });
        const ha = new RealHA(connection);
        subscribeEntities(connection, (entities) => ha.apply(entities));
        return ha;
    }
    async callService(call) {
        await haCallService(this.connection, call.domain, call.service, call.data, call.target);
    }
    entitiesSnapshot() {
        return Object.fromEntries(this.latest);
    }
    onEntities(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    /** Apply a merged-state snapshot, updating only entities whose data actually changed. */
    apply(entities) {
        const next = applyEntities(this.latest, this.lastRaw, entities);
        this.latest = next.latest;
        this.lastRaw = next.lastRaw;
        if (next.changed)
            this.listeners.forEach((cb) => cb());
    }
}
