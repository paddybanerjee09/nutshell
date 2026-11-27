---
id: decision-fixture-setup-proposals
date: "2026-11-26"
status: accepted
tags: [decision, fixture, onboarding, authorization]
decision_key: architecture.fixture-setup-proposals
---

## Context

Local setup needs persistent proposal state, genuine default-branch fixture changes, and an explicit trigger for exercising the signed provider ingestion path. Configuration requires a stronger grant than ordinary repository editing.

## Decision

Authorize setup through the explicit local configuration grant. Store one proposal per repository connection epoch with its immutable base, candidate revision, exact check, and stable delivery ID. Validate the candidate with the service-owned parser and require the checked head and base at simulated merge. Send the resulting push through the loopback signed webhook and the [receipt outbox](2026-11-26-fixture-receipt-outbox.md).

## Consequences

Repeated setup returns the same open proposal for a matching base. A base change refreshes that proposal with a newly checked head. A retry after a transport failure uses the stored merge and delivery identifiers. A late receipt from an old epoch is rejected. The repository panel marks setup synced when its exact merge revision is the published head.

## Affected files

- [Setup tree builder](../../packages/core/src/fixture-setup-tree.ts)
- [Fixture onboarding service](../../packages/server/src/fixture-onboarding.ts)
- [Fixture synchronization](../../packages/server/src/fixture-sync.ts)
- [Synchronization context](../features/github-sync/CONTEXT.md)
