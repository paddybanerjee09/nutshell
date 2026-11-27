---
id: feature-product-history
date: "2026-11-26"
status: planned
tags: [feature, history, entities, evidence]
---

## Context

Planned feature only. No indexed revisions or verified product events exist. Product semantic history is distinct from agent task notes and finalized planning decisions.

## Decision

Follow [R-07 product map and history](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Connect stable entities to changes, immutable source revisions, and truthful evidence; keep current context separate from historical product events.

## Consequences

Do not invent past changes or label generated descriptions as human-reviewed. Relevant gates: A11, A16. The new single-task memory workflow does not convert CURRENT_TASK into a product event log.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited product requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — data and event contracts.
- Actual schemas, indexing code, and tests: not established.
