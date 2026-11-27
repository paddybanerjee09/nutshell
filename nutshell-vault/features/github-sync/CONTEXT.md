---
id: feature-github-sync
date: "2026-11-26"
status: planned
tags: [feature, github, synchronization, provider]
---

## Context

Planned feature only. No adapter, webhook, external setup, or acceptance is verified. Scope covers local provider scenarios, live integration, onboarding, and durable ingestion.

## Decision

Follow [R-08 integration](../../../SPEC.md#11-r-08-accounts-access-and-github-integration) and [R-09 durable sync](../../../SPEC.md#12-r-09-durable-synchronization-validation-and-media). Reuse domain services across providers and preserve explicit source revisions and error states.

## Consequences

A simulated merge is not a live GitHub merge or deployment. Relevant gates: A09, A10, A23. Preserve the separation between product fixture events and the actual development feature PR tracked in CURRENT_TASK.

## Affected files

- [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — provider and record semantics.
- [Local execution decision](../../decisions/2026-11-26-local-alpha-execution.md).
- Actual adapter, worker, and test files: not established.
