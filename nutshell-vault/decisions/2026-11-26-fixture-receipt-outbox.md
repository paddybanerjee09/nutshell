---
id: decision-fixture-receipt-outbox
date: "2026-11-26"
status: accepted
tags: [decision, fixture, synchronization]
decision_key: architecture.fixture-receipt-outbox
---

## Context

The local fixture provider needs durable delivery acceptance and immutable snapshot publication. [The system architecture](../architecture/SYSTEM.md) permits a transactional outbox and requires reconciliation against the current ref and connection epoch.

## Decision

Use the PostgreSQL delivery receipt as the outbox row. The fixture webhook commits its stable delivery identifier, repository and installation scope, epoch, policy versions, and revision before acknowledging it. The worker locks one queued row, then rechecks the current installation, repository epoch, and fixture head before publication. Persist validated projections by immutable revision and publish the pointer in the same transaction as receipt completion.

## Consequences

Concurrent workers skip locked deliveries. Transient failures get a bounded retry schedule. Invalid or obsolete events leave the last accepted pointer available to authorized readers. The first slice handles local fixture default-branch pushes; live provider reads and setup proposal acceptance have separate gates.

## Affected files

- [Fixture synchronization](../../packages/server/src/fixture-sync.ts)
- [Worker](../../apps/worker/src/main.ts)
- [Fixture webhook](../../apps/web/src/app/api/github/webhook/route.ts)
- [Synchronization context](../features/github-sync/CONTEXT.md)
