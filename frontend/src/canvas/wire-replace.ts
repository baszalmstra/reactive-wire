import { addEdge, type Connection, type Edge } from "@xyflow/react";

/**
 * Apply a new input connection under the single-source rule: an input pin holds at most one wire.
 * Any wire already landing on the same target pin is dropped in the same result that adds the new
 * one, so the returned set differs from the input by one delete plus one add (or just an add when
 * the pin was empty). Returning the whole next edge set lets the caller commit the replacement as a
 * single state change — one history checkpoint, and one delete+add for the collaborative document.
 */
export function replaceInputEdge(edges: Edge[], connection: Connection): Edge[] {
  const freed = edges.filter(
    (e) => !(e.target === connection.target && (e.targetHandle ?? null) === (connection.targetHandle ?? null)),
  );
  return addEdge({ ...connection, type: "rw" }, freed);
}

/**
 * Whether this exact wire — same source, target, and both handles — is already present. Used to
 * skip the no-op case where a connection redraws the wire already on the input: replacing it would
 * produce an identical edge set, so there is nothing to commit or to checkpoint for undo.
 */
export function connectionAlreadyWired(edges: Edge[], connection: Connection): boolean {
  return edges.some(
    (e) =>
      e.source === connection.source &&
      (e.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      e.target === connection.target &&
      (e.targetHandle ?? null) === (connection.targetHandle ?? null),
  );
}
