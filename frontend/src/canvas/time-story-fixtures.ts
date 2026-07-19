import { evaluate, type Memory } from "../../../shared/engine/evaluate.js";
import { REGISTRY } from "../../../shared/engine/nodes/index.js";
import { DEMO_HOME_LOCATION } from "../../../shared/home.js";
import type { NodeData } from "../../../shared/node-types.js";
import type { EvalResults } from "../../../shared/results.js";

/** A spring date where every default and wrapped Amsterdam twilight boundary exists. */
export const TIME_STORY_NOW = Date.parse("2026-03-18T12:00:00Z");

/** Build story values through the same evaluator used by both preview and deployed runtime. */
export function environmentalStoryFixture(
  kind: "time-of-day" | "twilight",
  id: string,
  config?: Record<string, unknown>,
): { node: NodeData; results: EvalResults } {
  const made = REGISTRY[kind]!.template.make(id) as NodeData;
  const node = config ? { ...made, config: { ...made.config, ...config } } : made;
  const results = evaluate(
    [node],
    [],
    {},
    {} as Memory,
    TIME_STORY_NOW,
    {},
    {},
    { homeLocation: DEMO_HOME_LOCATION },
  );
  return { node, results };
}
