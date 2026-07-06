import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { statePolicy } from "../../shared/engine/engine-support.js";
import { log } from "./log.js";
/**
 * Persists the memory slots of nodes whose declared state policy is "durable" to a JSON file, so
 * an accumulated fold/scan survives a redeploy or a server restart. Slots are keyed by node id and
 * tagged with the node type; on restore, slots for nodes no longer in the graph — or whose type
 * changed — are dropped. Disk writes are debounced so a busy tick loop does not thrash the file.
 */
export class DurableMemoryStore {
    filePath;
    slots = {};
    debounceMs;
    timer = null;
    lastWritten = "";
    constructor(options = {}) {
        this.filePath = join(options.dataDir ?? ".rw-data", options.fileName ?? "durable-memory.json");
        this.debounceMs = options.debounceMs ?? 200;
        this.load();
    }
    /** Restore durable slots into `mem` and forget slots that no longer belong to the deployed graph. */
    restore(nodes, mem) {
        const durable = durableTypes(nodes);
        const kept = {};
        for (const [id, type] of durable) {
            const slot = this.slots[id];
            if (slot && slot.type === type) {
                mem[id] = structuredClone(slot.mem);
                kept[id] = slot;
            }
        }
        this.slots = kept;
        this.scheduleWrite();
    }
    /** Capture the current durable slots from `mem` after a tick, scheduling a debounced write on change. */
    capture(nodes, mem) {
        const durable = durableTypes(nodes);
        const next = {};
        for (const [id, type] of durable) {
            const slot = mem[id];
            if (slot === undefined)
                continue;
            // Deep-copy so the persisted snapshot is decoupled from the live memory the engine keeps
            // mutating. Durable state is stored as JSON, so a slot that cannot survive a JSON round-trip
            // (circular, BigInt) is skipped with a warning rather than silently corrupting the file.
            const copy = toPersistable(id, slot);
            if (copy)
                next[id] = { type, mem: copy };
        }
        this.slots = next;
        this.scheduleWrite();
    }
    /** Write any pending change to disk immediately. */
    flush() {
        const serialized = JSON.stringify(this.slots);
        if (serialized !== this.lastWritten)
            this.write(serialized);
    }
    /** Cancel any pending debounced write and flush the latest state to disk. */
    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.flush();
    }
    load() {
        if (!existsSync(this.filePath))
            return;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
            if (parsed && typeof parsed === "object" && parsed.slots && typeof parsed.slots === "object") {
                if (parsed.version !== 1) {
                    // A file written by an incompatible format version is not corrupt, but its slots may not
                    // match what this build restores; start empty rather than trusting them.
                    log("warn", "durable-memory", "ignoring durable memory from an incompatible version", { version: parsed.version });
                    return;
                }
                this.slots = parsed.slots;
                this.lastWritten = JSON.stringify(this.slots);
            }
        }
        catch {
            // A corrupt or unreadable durable file must not stop the runtime; start from an empty set.
            this.slots = {};
        }
    }
    scheduleWrite() {
        if (JSON.stringify(this.slots) === this.lastWritten)
            return;
        if (this.debounceMs <= 0) {
            this.flush();
            return;
        }
        if (this.timer)
            return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.flush();
        }, this.debounceMs);
        this.timer.unref?.();
    }
    write(serialized) {
        mkdirSync(dirname(this.filePath), { recursive: true });
        const file = { version: 1, slots: JSON.parse(serialized) };
        const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        writeFileSync(tmp, JSON.stringify(file));
        renameSync(tmp, this.filePath);
        this.lastWritten = serialized;
    }
}
/** Deep-copy a slot for persistence, or return null (with a warning) if it can't survive a JSON round-trip. */
function toPersistable(id, slot) {
    try {
        const copy = structuredClone(slot);
        JSON.stringify(copy);
        return copy;
    }
    catch {
        log("warn", "durable-memory", "skipping slot: state is not JSON-serializable", { node: id });
        return null;
    }
}
/** Map of node id to node type for every node whose declared state policy is "durable". */
function durableTypes(nodes) {
    const out = new Map();
    for (const n of nodes) {
        if (statePolicy(n.config ?? {}) === "durable")
            out.set(n.id, n.type);
    }
    return out;
}
