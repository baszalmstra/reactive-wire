import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";

export type Severity = "error" | "warn";
export type Scope = "structural" | "runtime";

/** One entry in the Problems panel, tracing back to the node that produced it. */
export interface Problem {
  id: string;
  severity: Severity;
  scope: Scope;
  node: string;
  title: string;
  message: string;
}

/**
 * Reads node and wire problems straight out of the already-computed evaluation results,
 * splitting them into structural (edit-time wiring/schema issues) and runtime (live value)
 * problems. The UI never re-derives semantics here — it only translates results into prose.
 */
export function deriveProblems(
  nodes: NodeData[],
  results: EvalResults,
  connected: boolean,
): Problem[] {
  const out: Problem[] = [];

  for (const n of nodes) {
    for (const p of n.outputs) {
      const v = results.outputs[`${n.id}:${p.id}`];
      if (p.ghost) {
        out.push({
          id: `g-${n.id}-${p.id}`,
          severity: "error",
          scope: "structural",
          node: n.id,
          title: n.title,
          message: `Attribute '${p.missing ?? p.label}' is no longer exposed by the entity — pin kept as a ghost.`,
        });
      } else if (v && v.status === "error") {
        out.push({
          id: `e-${n.id}-${p.id}`,
          severity: "error",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: v.msg ? `Output '${p.label}' is in an error state: ${v.msg}` : `Output '${p.label}' is in an error state.`,
        });
      }
    }

    if (n.type === "select") {
      const unwired = ["cond", "a", "b"].filter((pid) => !results.connected[`${n.id}:${pid}`]);
      if (unwired.length) {
        // The output type is fixed by either branch, so it is only still 'any' when neither a nor b is wired.
        const typeUnresolved = !results.connected[`${n.id}:a`] && !results.connected[`${n.id}:b`];
        const tail = typeUnresolved ? "; output type is still 'any'." : ".";
        out.push({
          id: `sel-${n.id}`,
          severity: "warn",
          scope: "structural",
          node: n.id,
          title: n.title,
          message: `Unresolved — ${unwired.join(", ")} not wired${tail}`,
        });
      }
    }
  }

  for (const n of nodes) {
    for (const p of n.inputs) {
      const v = results.inputs[`${n.id}:${p.id}`];
      if (v && v.status === "unavailable") {
        out.push({
          id: `u-${n.id}-${p.id}`,
          severity: "warn",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: `Input '${p.label || p.id}' is unavailable.`,
        });
      }
    }
  }

  if (!connected && nodes.length) {
    out.push({
      id: "ha",
      severity: "warn",
      scope: "runtime",
      node: nodes[0].id,
      title: "Home Assistant",
      message: "Editor feed disconnected — live server state is unknown; a previously deployed graph may still be running.",
    });
  }

  return out;
}

/** Counts of hard errors and soft warnings across a problems list. */
export function problemCounts(problems: Problem[]): { errors: number; warns: number } {
  let errors = 0;
  let warns = 0;
  for (const p of problems) {
    if (p.severity === "error") errors += 1;
    else warns += 1;
  }
  return { errors, warns };
}
