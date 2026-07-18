# Verifying a change

The verification ladder as an executable checklist: which command to run for which kind of change,
expected runtimes, what a green result looks like, and the rule that engine/server changes ship
with a unit test. Use before calling a change done, or when unsure how much verification a change
needs. Climb only as far as the change reaches — do not run e2e for a change unit tests already
cover.

## The ladder

| Change touches | Run | ~Runtime | Green looks like |
| --- | --- | --- | --- |
| Anything (always) | `pixi run check` | seconds | core/editor typechecks and frontend lint are clean; all unit tests pass |
| An isolated frontend component | `pixi run storybook` | interactive | the component renders/behaves correctly in isolation |
| Cross-cutting editor flow (deploy, canvas, collab) | `pixi run e2e` | ~1 min | Playwright suite, including accessibility scenarios, passes |

`pixi run check` runs core/editor typechecks, the frontend ESLint rules, and the unit suite — the
default gate for every change. The unit suite includes automated theme contrast checks; keyboard,
focus, touch-target, and reduced-motion behavior is covered by `e2e/accessibility.spec.ts` in the
Playwright gate. `pixi run e2e` starts its own mock server + Vite on isolated ports; reach for it only when
the change spans the editor and server together and no unit test can exercise it.

## The unit-test rule

Any change to `shared/engine/` or `src/server/` ships with a unit test alongside it in `test/`.
Match the existing style:

- Engine/node behavior: drive `evaluate(...)` directly and assert on the returned values/health
  (see `test/evaluate.test.ts`, `test/sinks.test.ts`).
- Server runtime/actuation: drive the `Deployer` against a `MockHA` and assert on `ha.calls`
  (see `test/sink-runtime.test.ts`).
- Feed/WebSocket protocol: start `startFeed` on an ephemeral port and talk to it with a real `ws`
  client (see `test/feed-collab.test.ts`, `test/feed-debug.test.ts`).

A behavioral change with no accompanying test is not done, even if `check` is green.

## What green means

- `pixi run check` exits 0 with no `tsc` or ESLint diagnostics and every test file passing.
- A red typecheck or a failing test blocks the change — fix the cause, do not skip or `.only`.
- When a change has a runtime surface, also confirm the actual behavior (see
  [debug-live.md](./debug-live.md) to query a running server) — passing tests plus a real
  observation, not tests alone.
