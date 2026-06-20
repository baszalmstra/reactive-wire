/**
 * A value flowing on a wire. Every behavior carries one of these at all times:
 * a concrete value, the absence of a value (the source is offline / not yet known),
 * or an error describing why a value could not be produced.
 */
export type Value<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error"; readonly message: string };

export const ok = <T>(value: T): Value<T> => ({ kind: "ok", value });
export const unavailable = <T = never>(): Value<T> => ({ kind: "unavailable" });
