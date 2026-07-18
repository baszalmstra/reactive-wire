/**
 * Reversible identities for graph paths and pin endpoints. Delimiters remain readable for common
 * identifiers, while delimiter characters inside an individual segment are percent-escaped.
 */

function encodeSegment(value: string, delimiter: ":" | "/"): string {
  const escaped = value.replaceAll("%", "%25");
  return delimiter === ":" ? escaped.replaceAll(":", "%3A") : escaped.replaceAll("/", "%2F");
}

function decodeSegment(value: string): string {
  return decodeURIComponent(value);
}

/** A collision-free result-map key for one node pin. Ordinary ids retain `node:pin`. */
export function pinKey(nodeId: string, pinId: string): string {
  return `${encodeSegment(nodeId, ":")}:${encodeSegment(pinId, ":")}`;
}

/** Reverse a key produced by {@link pinKey}. */
export function decodePinKey(key: string): { nodeId: string; pinId: string } {
  const separator = key.indexOf(":");
  if (separator < 0) throw new Error("Invalid pin key");
  return {
    nodeId: decodeSegment(key.slice(0, separator)),
    pinId: decodeSegment(key.slice(separator + 1)),
  };
}

/** Append one raw segment to an already-encoded graph path. Ordinary paths retain `a/b`. */
export function appendPath(prefix: string, segment: string): string {
  const encoded = encodeSegment(segment, "/");
  return prefix ? `${prefix}/${encoded}` : encoded;
}

/** Decode a path produced by repeated {@link appendPath} calls. */
export function decodePath(path: string): string[] {
  return path === "" ? [] : path.split("/").map(decodeSegment);
}

/** True when candidate is nested strictly below parent in an encoded graph path. */
export function isDescendantPath(parent: string, candidate: string): boolean {
  return candidate.startsWith(`${parent}/`);
}
