---
id: feature-product-history
date: "2026-11-27"
status: planned
tags: [feature, history, entities, evidence]
---

## Context

Authorized indexed snapshots contain declared entities and change records. The Product Map shows the current entity relationships and indexed revision. Durable semantic history remains planned.

## Decision

Follow [R-07 product map and history](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Connect stable entities to changes, immutable source revisions, and truthful evidence; keep current context separate from historical product events.

## Consequences

Do not invent past changes or label generated descriptions as human-reviewed. Relevant gates: A11, A16. The new single-task memory workflow does not convert CURRENT_TASK into a product event log.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited product requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — data and event contracts.
- [Repository schemas and projection](../../../packages/core/src/repo-snapshot.ts).
- [Workspace relationship model](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph-model.ts).
