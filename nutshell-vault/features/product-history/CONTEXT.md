---
id: feature-product-history
date: "2026-11-27"
status: active
tags: [feature, history, entities, evidence]
---

## Context

Authorized indexed snapshots contain declared entities and change records. The Product Map shows the current entity relationships and indexed revision. Private screenshot evidence uses repository-owned assets. Durable semantic history remains planned.

## Decision

Follow [R-07 product map and history](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Connect stable entities to changes, immutable source revisions, and truthful evidence; keep current context separate from historical product events.

For [R-09 media](../../../SPEC.md#media-and-screenshots), writers upload single-frame PNG, JPEG, or WebP. The server checks the container, fully decodes and strips ancillary metadata, and stores the clean raster outside the web directory under `.local/media/`. Uploads and the output are limited to 8 MiB, each edge to 4,096 pixels, and the raster to 12 million pixels. Development and verification assets use separate directories and databases.

Every asset has a database-owned repository, opaque key, MIME type, dimensions, size, digest, and provenance. Reads recheck current repository access and verify private bytes before delivery. A referenced asset with absent or invalid bytes is unavailable.

Values declared in Git remain declarations. The fixture capture label requires a controlled local browser run, matching stored capture metadata, a current indexed fixture source at capture time, and successful authorized image loading.

## Consequences

Do not invent past changes or label generated descriptions or fixture captures as human-reviewed or deployed. The single-task memory workflow does not convert CURRENT_TASK into a product event log. The [acceptance ledger](../../runs/ACCEPTANCE.md) records graph, history, and media evidence.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited product requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — data and event contracts.
- [Repository schemas and projection](../../../packages/core/src/repo-snapshot.ts).
- [Workspace relationship model](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph-model.ts).
- [Raster validation](../../../packages/server/src/raster.ts), [asset service](../../../packages/server/src/screenshot-assets.ts), and [asset migration](../../../packages/server/migrations/0007_screenshot_assets.sql).
