---
name: verify-change
description: The verification ladder for Reactive Wire as an executable checklist — which command to run for which kind of change, expected runtimes, what a green result looks like, and the rule that engine/server changes ship with a unit test. Use before calling a change done, or when unsure how much verification a change needs.
---

Follow the agent-neutral guide at [docs/agents/verify-change.md](../../../docs/agents/verify-change.md).

Quick reference: `pixi run check` (typecheck + unit tests + frontend lint) gates every change; Storybook for
isolated component work; `pixi run e2e` only for cross-cutting editor flows. Any `shared/engine/`
or `src/server/` change ships with a unit test in `test/` — a behavioral change without one is not
done, even if `check` is green.
