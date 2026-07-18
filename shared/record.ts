/** Identifier spellings that can affect ordinary JavaScript object prototypes. */
const FORBIDDEN_IDENTIFIERS = new Set(["__proto__", "prototype", "constructor"]);

/** Whether a persisted/runtime identifier is safe to use at every graph boundary. */
export function isSafeIdentifier(value: string): boolean {
  return value.length > 0 && !FORBIDDEN_IDENTIFIERS.has(value);
}

/** A string-keyed dictionary with no inherited prototype properties. */
export function createRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** Copy a string-keyed dictionary into a prototype-free record. */
export function copyRecord<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  return Object.assign(createRecord<T>(), source);
}

/** Read only an own dictionary entry, never an inherited prototype property. */
export function ownValue<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

/** Define an own entry without invoking the legacy __proto__ setter. */
export function setOwn<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
