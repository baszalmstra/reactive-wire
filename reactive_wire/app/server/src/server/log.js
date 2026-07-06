const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
function threshold() {
    const raw = (process.env.RW_LOG_LEVEL ?? "info").trim().toLowerCase();
    return ORDER[raw] ?? ORDER.info;
}
// Render one field value: bare when it is a token with no whitespace, JSON-quoted otherwise, so a
// value never breaks the key=value splitting and objects stay on the single line.
function formatValue(v) {
    if (v === null)
        return "null";
    if (v === undefined)
        return "undefined";
    if (typeof v === "number" || typeof v === "boolean")
        return String(v);
    if (typeof v === "string")
        return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
    try {
        return JSON.stringify(v);
    }
    catch {
        return JSON.stringify(String(v));
    }
}
function formatFields(fields) {
    return Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(" ");
}
/** Emit a single structured log line to stdout when the level passes the RW_LOG_LEVEL filter. */
export function log(level, component, message, fields) {
    if (ORDER[level] < threshold())
        return;
    let line = `${new Date().toISOString()} ${level} [${component}] ${message}`;
    if (fields) {
        const rendered = formatFields(fields);
        if (rendered)
            line += ` ${rendered}`;
    }
    process.stdout.write(`${line}\n`);
}
