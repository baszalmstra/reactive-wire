---
name: review-rounds
description: A multi-round review process for large or cross-cutting changes in Reactive Wire — fan out parallel domain-scoped reviewers, consolidate and rank their findings, then triage into fix-now vs roadmap. Use when reviewing a big diff (several modules, an engine/server/editor change together) where a single pass would miss things or drown in duplicates.
---

Follow the agent-neutral guide at [docs/agents/review-rounds.md](../../../docs/agents/review-rounds.md).

Quick reference: round 1 fans out domain-scoped reviewers (engine / server / frontend / tests+docs),
each returning findings with `file:line` and severity; round 2 dedupes, ranks, and resolves
disagreements; triage splits fix-now (blocks the change) from roadmap (recorded in DESIGN.md §9).
