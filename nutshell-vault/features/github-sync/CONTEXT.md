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

The setup tree builder reads the immutable base, preserves tracked owner content, and appends one delimited instructions section to `AGENTS.md`. It generates missing vault and record files, refuses conflicting managed content, and validates the resulting tree with the same projector used by the worker.

[Fixture setup](../../decisions/2026-11-26-fixture-setup-proposals.md) requires an explicit configuration grant and uses a revision-bound proposal. The setup route sends the stored merge delivery to the signed ingress and reuses the same identity on retry.

## Consequences

The local repository page shows awaiting merge, indexing, or confirmation of the exact indexed revision. Reader sessions can view the setup state. Source-development PRs, revision-linked history, and live GitHub App behavior have separate evidence.

## Affected files

- [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — provider and record semantics.
- [Local execution decision](../../decisions/2026-11-26-local-alpha-execution.md).
- [Record projector](../../../packages/core/src/repo-snapshot.ts), [fixture synchronization](../../../packages/server/src/fixture-sync.ts), and [worker](../../../apps/worker/src/main.ts).
- [Setup tree builder](../../../packages/core/src/fixture-setup-tree.ts) and [owner-content regressions](../../../packages/core/src/fixture-setup-tree.test.ts).
- [Fixture onboarding service](../../../packages/server/src/fixture-onboarding.ts) and [local browser journey](../../../scripts/local-browser.ts).
- [Fixture webhook](../../../apps/web/src/app/api/github/webhook/route.ts) and [verification journey](../../../scripts/fixture-sync-verify.ts).
