import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";
import { pinKey } from "../../../shared/identity.js";

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
      const v = results.outputs[pinKey(n.id, p.id)];
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
          message: v.msg ? `Output '${p.label || p.id}' is in an error state: ${v.msg}` : `Output '${p.label || p.id}' is in an error state.`,
        });
      } else if (v && v.status === "unavailable") {
        out.push({
          id: `uo-${n.id}-${p.id}`,
          severity: "warn",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: `Output '${p.label || p.id}' is unavailable.`,
        });
      } else if (v && v.status === "stale") {
        out.push({
          id: `so-${n.id}-${p.id}`,
          severity: "warn",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: `Output '${p.label || p.id}' is stale; showing the last known value.`,
        });
      }
    }

    if (n.type === "select") {
      const unwired = ["cond", "a", "b"].filter((pid) => !results.connected[pinKey(n.id, pid)]);
      if (unwired.length) {
        // The output type is fixed by either branch, so it is only still 'any' when neither a nor b is wired.
        const typeUnresolved = !results.connected[pinKey(n.id, "a")] && !results.connected[pinKey(n.id, "b")];
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
      const v = results.inputs[pinKey(n.id, p.id)];
      if (v && v.status === "error") {
        out.push({
          id: `ei-${n.id}-${p.id}`,
          severity: "error",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: v.msg ? `Input '${p.label || p.id}' is in an error state: ${v.msg}` : `Input '${p.label || p.id}' is in an error state.`,
        });
      } else if (v && v.status === "unavailable") {
        out.push({
          id: `ui-${n.id}-${p.id}`,
          severity: "warn",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: `Input '${p.label || p.id}' is unavailable.`,
        });
      } else if (v && v.status === "stale") {
        out.push({
          id: `si-${n.id}-${p.id}`,
          severity: "warn",
          scope: "runtime",
          node: n.id,
          title: n.title,
          message: `Input '${p.label || p.id}' is stale; showing the last known value.`,
        });
      }
    }

    const action = results.actions[n.id];
    if (action?.status === "error") {
      out.push({
        id: `act-e-${n.id}`,
        severity: "error",
        scope: "runtime",
        node: n.id,
        title: n.title,
        message: action.note ? `Sink action is blocked: ${action.note}.` : "Sink action is blocked by an error.",
      });
    } else if (action?.status === "unavailable") {
      out.push({
        id: `act-u-${n.id}`,
        severity: "warn",
        scope: "runtime",
        node: n.id,
        title: n.title,
        message: action.note ? `Sink action is holding: ${action.note}.` : "Sink action is holding because a required value is unavailable.",
      });
    } else if (action?.status === "stale") {
      out.push({
        id: `act-s-${n.id}`,
        severity: "warn",
        scope: "runtime",
        node: n.id,
        title: n.title,
        message: action.note ? `Sink action is stale: ${action.note}.` : "Sink action is based on stale values.",
      });
    }
  }

  if (!connected && nodes.length) {
    out.push({
      id: "ha",
      severity: "warn",
      scope: "runtime",
      node: nodes[0]!.id,
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
