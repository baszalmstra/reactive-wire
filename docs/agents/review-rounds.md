# Multi-round review

A multi-round review process for large or cross-cutting changes: fan out parallel domain-scoped
reviewers, consolidate and rank their findings, then triage into fix-now vs roadmap. Use when
reviewing a big diff (several modules, an engine/server/editor change together) where a single pass
would miss things or drown in duplicates. For a large change, one reviewer either misses
cross-cutting issues or produces an unranked pile — split the work, then converge.

## Round 1 — parallel domain-scoped reviewers

Launch several reviewers at once (parallel agents, or sequential passes with a fresh context each),
each scoped to one domain so coverage is broad and non-overlapping. Scope to the parts of the diff
that exist; typical domains for this repo:

- **engine** — `shared/engine/` and `shared/*.ts`: value/status correctness, Kleene 3-valued
  logic, macro expansion, per-node memory.
- **server** — `src/server/` and `src/ha/`: deployer reconciliation and safety rule, feed protocol
  and backpressure, connection policy, persistence.
- **frontend** — `frontend/src/`: React Flow canvas, validation, inspector, value editors.
- **tests + docs** — `test/`, README/DESIGN/agent docs: coverage of new behavior, doc accuracy.

Each reviewer returns findings as a flat list, every finding carrying a concrete `file:line`, a
one-line description, and a severity. Require file:line so round 2 can dedupe and the author can
jump straight to the code.

## Round 2 — consolidation

One consolidation pass over all findings:

- **Deduplicate** — collapse the same issue reported by multiple reviewers into one entry.
- **Rank** — order by severity: correctness/safety bugs (especially anything that could actuate on
  a non-`ok` value or bypass the deploy-token gate) first, then reuse/simplification, then style.
- **Resolve conflicts** — where reviewers disagree, decide, and note why.

## Triage — fix-now vs roadmap

Split the ranked list:

- **fix-now** — correctness, safety, and regressions in the current change; anything that makes the
  diff wrong. These block the change.
- **roadmap** — larger refactors, pre-existing issues, and nice-to-haves the change surfaced but
  didn't introduce. Record them (DESIGN.md roadmap / an issue) rather than expanding this change.

Keep the output to the deduped, ranked, triaged list with file:line — not the raw per-reviewer
dumps.
