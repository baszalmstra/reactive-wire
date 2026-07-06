import {} from "./client.js";
/**
 * An in-memory Home Assistant stand-in. Entity changes drive the reactive graph;
 * service calls are recorded rather than executed so tests can assert on them.
 */
export class MockHA {
    entities = new Map();
    listeners = new Set();
    calls = [];
    callService(call) {
        this.calls.push(call);
    }
    entitiesSnapshot() {
        return Object.fromEntries(this.entities);
    }
    onEntities(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    /** Set an entity's state and attributes, as if Home Assistant reported a change. */
    setState(entityId, state, attributes = {}) {
        this.entities.set(entityId, { state, attributes });
        this.listeners.forEach((cb) => cb());
    }
    /** Remove an entity entirely, as if it were deleted from Home Assistant. */
    remove(entityId) {
        this.entities.delete(entityId);
        this.listeners.forEach((cb) => cb());
    }
    /** The most recent service call, or undefined if none have been made. */
    lastCall() {
        return this.calls[this.calls.length - 1];
    }
}
