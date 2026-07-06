/** JSON-compatible data carried over the editor/server protocol and persisted documents. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Narrow an arbitrary value to a plain object record (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse JSON without letting `JSON.parse` leak `any` into callers. */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Parse a JSON object frame; non-object JSON and malformed input return null. */
export function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = parseJson(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

/** Runtime guard for the serializable subset we intentionally persist or send over JSON. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth > 20) return false;
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item, depth + 1));
}
