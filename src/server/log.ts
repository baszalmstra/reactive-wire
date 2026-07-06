/**
 * A dependency-free structured logger. Every entry is one line on stdout: an ISO timestamp, the
 * level, a bracketed component tag, the message, then any fields as space-separated key=value
 * pairs. The format stays plain and greppable — no colors, no framing — so operators can filter
 * with grep and machines can split on the fixed leading columns.
 *
 * RW_LOG_LEVEL (debug|info|warn|error, default info) drops anything below the chosen level.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const raw = (process.env.RW_LOG_LEVEL ?? "info").trim().toLowerCase();
  return ORDER[raw as LogLevel] ?? ORDER.info;
}

// Render one field value: bare when it is a token with no whitespace, JSON-quoted otherwise, so a
// value never breaks the key=value splitting and objects stay on the single line.
function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "string") return /[\s"=]/.test(v) ? JSON.stringify(v) : v;
  try {
    return JSON.stringify(v);
  } catch {
    return JSON.stringify(String(v));
  }
}

function formatFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(" ");
}

/** Emit a single structured log line to stdout when the level passes the RW_LOG_LEVEL filter. */
export function log(level: LogLevel, component: string, message: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  let line = `${new Date().toISOString()} ${level} [${component}] ${message}`;
  if (fields) {
    const rendered = formatFields(fields);
    if (rendered) line += ` ${rendered}`;
  }
  process.stdout.write(`${line}\n`);
}
