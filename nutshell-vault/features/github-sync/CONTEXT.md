---
id: feature-github-sync
date: "2026-11-26"
status: active
tags: [feature, github, synchronization, provider]
---

## Context

The local fixture provider stores an immutable source tree and a default-branch head for each fixture repository. The separately supervised worker processes accepted fixture receipts and continues to serve the pg-boss health probe.

## Decision

Follow [R-08 integration](../../../SPEC.md#11-r-08-accounts-access-and-github-integration) and [R-09 durable sync](../../../SPEC.md#12-r-09-durable-synchronization-validation-and-media). Reuse domain services across providers and preserve explicit source revisions and error states.

The fixture webhook validates the configured raw-body HMAC and accepts default-branch push deliveries through the [receipt outbox](../../decisions/2026-11-26-fixture-receipt-outbox.md). The core projector validates the immutable tree and the authenticated snapshot API returns the published revision, provider head, and status.

## Consequences

Local fixture events exercise the product ingestion path independently of development PRs. Setup proposal simulation, accepted event history, and the live GitHub App adapter still have separate acceptance gates.

## Affected files

- [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — provider and record semantics.
- [Local execution decision](../../decisions/2026-11-26-local-alpha-execution.md).
- [Record projector](../../../packages/core/src/repo-snapshot.ts), [fixture synchronization](../../../packages/server/src/fixture-sync.ts), and [worker](../../../apps/worker/src/main.ts).
- [Fixture webhook](../../../apps/web/src/app/api/github/webhook/route.ts) and [verification journey](../../../scripts/fixture-sync-verify.ts).
