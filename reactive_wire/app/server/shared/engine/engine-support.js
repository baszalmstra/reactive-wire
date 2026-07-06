/**
 * Read a dot-separated path (e.g. "main.temp" or "results.0.value") out of a fetched body.
 * An empty path returns the body itself. A missing key or out-of-range index returns
 * undefined, which the caller treats as "value not present".
 */
export function readPath(body, path) {
    const trimmed = path.trim();
    if (!trimmed)
        return body;
    let cur = body;
    for (const key of trimmed.split(".")) {
        if (cur == null)
            return undefined;
        if (Array.isArray(cur)) {
            const i = Number(key);
            cur = Number.isInteger(i) ? cur[i] : undefined;
        }
        else if (typeof cur === "object") {
            cur = cur[key];
        }
        else {
            return undefined;
        }
    }
    return cur;
}
/** A stateful node's declared persistence policy, defaulting to ephemeral boot-seeding. */
export function statePolicy(cfg) {
    const p = cfg.persistence;
    if (p === "durable" || p === "reseed-from-world")
        return p;
    return "seed-at-boot";
}
/** Worst-status combine; stale still computes so last-known values keep flowing. */
export function gate(inputs) {
    if (inputs.some((x) => x && x.status === "error"))
        return "error";
    if (inputs.some((x) => !x || x.status === "unavailable"))
        return "unavailable";
    if (inputs.some((x) => x && x.status === "stale"))
        return "stale";
    return "ok";
}
export function round1(x) {
    return Math.round(x * 10) / 10;
}
export function toNumber(x, fallback) {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
}
/**
 * Combine a running fold accumulator with the next value for the given operation. For min/max
 * the very first accumulated value is taken as-is rather than combined with the configured
 * initial, so the result isn't pinned by a default seed (e.g. min never stuck at 0).
 */
export function applyFold(op, acc, next, first) {
    const a = toNumber(acc, 0);
    const b = toNumber(next, 0);
    switch (op) {
        case "count": return a + 1;
        case "max": return first ? b : Math.max(a, b);
        case "min": return first ? b : Math.min(a, b);
        case "sum":
        default: return a + b;
    }
}
export function applyCompare(a, op, b) {
    switch (op) {
        case "==": return a === b;
        case "!=": return a !== b;
        case "<": return a < b;
        case ">": return a > b;
        case "<=": return a <= b;
        case ">=": return a >= b;
        default: return false;
    }
}
/**
 * Seconds between two instants given as epoch milliseconds (`a - b`), rounded to one decimal.
 * This is how a datetime difference becomes a Duration, whose magnitude is a number of seconds.
 */
export function instantDiffSeconds(aMs, bMs) {
    return round1((aMs - bMs) / 1000);
}
/**
 * Shift an instant (epoch milliseconds) by a span of seconds, returning epoch milliseconds.
 * `dir` is +1 to move forward in time and -1 to move back, so a datetime plus/minus a Duration
 * stays a datetime.
 */
export function shiftInstant(instantMs, seconds, dir) {
    return instantMs + dir * seconds * 1000;
}
/** Seconds expressed by a duration count under the given unit. */
export function durationSeconds(count, unit) {
    switch (String(unit)) {
        case "ms": return count / 1000;
        case "min": return count * 60;
        case "hr": return count * 3600;
        case "sec":
        default: return count;
    }
}
/** The value type a configured input-helper sink expects, taken from its target entity's domain. */
export function inputHelperType(n) {
    const domain = String(n.config?.entity_id ?? "").split(".")[0] ?? "";
    switch (domain) {
        case "input_boolean": return "bool";
        case "input_number": return "num";
        case "input_text":
        case "input_select":
        default: return "str";
    }
}
