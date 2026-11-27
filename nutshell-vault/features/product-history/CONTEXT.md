---
id: feature-product-history
date: "2026-11-27"
status: active
tags: [feature, history, entities, evidence]
---

## Context

Authorized indexed snapshots contain declared entities and change records. The Product Map shows the current entity relationships and indexed revision. Private screenshot evidence uses repository-owned assets. The shared projection can validate a candidate against already accepted semantic events.

## Decision

Follow [R-07 product map and history](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Connect stable entities to changes, immutable source revisions, and truthful evidence; keep current context separate from historical product events.

When the worker supplies previously accepted records, projection compares their normalized payloads and retains their original references. New declarations resolve against their candidate revision. A correction or reversal in an established history targets a different accepted event.

For [R-09 media](../../../SPEC.md#media-and-screenshots), writers upload single-frame PNG, JPEG, or WebP. The server checks the container, fully decodes and strips ancillary metadata, and stores the clean raster outside the web directory under `.local/media/`. Uploads and the output are limited to 8 MiB, each edge to 4,096 pixels, and the raster to 12 million pixels. Development and verification assets use separate directories and databases.

Every asset has a database-owned repository, opaque key, MIME type, dimensions, size, digest, and provenance. Reads recheck current repository access and verify private bytes before delivery. A referenced asset with absent or invalid bytes is unavailable.

The Details dock gives current writers an asset ID to reference in a Git change record. Values declared in Git remain declarations. The fixture capture label requires a controlled local browser run, matching stored capture metadata, a current indexed fixture source at capture time, and successful authorized image loading.

## Consequences

Human review and deployment each require separate evidence. Product events come from repository change records. The [acceptance ledger](../../runs/ACCEPTANCE.md) records graph, history, and media evidence.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited product requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — data and event contracts.
- [Repository schemas and projection](../../../packages/core/src/repo-snapshot.ts).
- [Workspace relationship model](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph-model.ts).
- [Raster validation](../../../packages/server/src/raster.ts), [asset service](../../../packages/server/src/screenshot-assets.ts), and [asset migration](../../../packages/server/migrations/0007_screenshot_assets.sql).
- [Workspace evidence panel](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-screenshot-evidence.tsx) and [controlled capture verification](../../../scripts/fixture-screenshot-evidence.ts).
