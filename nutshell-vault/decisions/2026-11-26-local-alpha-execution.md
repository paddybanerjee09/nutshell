---
id: decision-local-alpha-execution
date: "2026-11-26"
status: accepted
tags: [decision, architecture, local-alpha, integration]
decision_key: architecture.local-alpha.execution
supersedes: nutshell-vault/archive/2026-11-26-workflow-migration/decisions/0001-local-execution.md
---

## Context

The user's accepted direction is a local-first Nutshell alpha whose local product behavior does not require live GitHub App setup. The separate development source repository must pass the real feature-PR preflight before feature implementation. [SPEC.md](../../SPEC.md) defines the build scope. This dated note preserves the planning choice; application implementation has not started.

## Decision

Use real local domain behavior and persistence with explicit provider boundaries. Simulated scenarios and live adapters reuse validation, authorization, and product logic. Keep product OAuth, App installation, customer-repository mutations, and external-service acceptance as separate gates. Real development feature PRs follow GIT_WORKFLOW and cannot be replaced by simulated customer PRs.

## Consequences

A live-product dependency would interrupt local work; a static mockup would not verify the product loop. Missing product App credentials do not block local feature work once source-repository PR preflight is ready. Missing initial source PR preflight blocks starting a feature; independent setup may continue. If access fails after a feature has begun, follow AGENTS and GIT_WORKFLOW's same-task recovery without claiming integration or starting another feature. Synthetic evidence and agent review remain distinct from human review and live acceptance. No application or provider tests have run.

This decision grants no authority to bypass environment policy or mutate remote repositories. The prior note is superseded and excluded from default retrieval.

## Affected files

- [SPEC.md](../../SPEC.md) — local outcome and live gates.
- [SYSTEM.md](../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../architecture/GITHUB_CONTRACT.md) — boundaries.
- [LOCAL_SETUP.md](../workflows/LOCAL_SETUP.md) and [GIT_WORKFLOW.md](../workflows/GIT_WORKFLOW.md) — mandatory source PR preflight and lifecycle.
- [Product overview](../product/OVERVIEW.md).
- [Superseded source note](../archive/2026-11-26-workflow-migration/decisions/0001-local-execution.md), for explicit historical inspection only.
