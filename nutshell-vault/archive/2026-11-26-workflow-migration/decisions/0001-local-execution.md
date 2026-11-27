---
id: archive-decisions-0001-local-execution-2026-11-26
date: "2026-11-26"
status: superseded
tags: [archive, workflow-migration]
superseded_by: nutshell-vault/decisions/2026-11-26-local-alpha-execution.md
---

> Superseded workflow snapshot. Original location: `nutshell-vault/decisions/0001-local-execution.md`. Use `nutshell-vault/decisions/2026-11-26-local-alpha-execution.md` instead. Excluded from default retrieval. Historic relative links below refer to the original location; the original text is preserved for provenance.

# 0001 Local execution with separate live acceptance

Status: accepted for planning from the user's local-first starter and autonomous-alpha direction. Implementation is not started by this decision.

## Context

Nutshell should eventually integrate with GitHub while allowing agents to complete useful local development without routine user decisions, external account setup, or interactive login. This deliverable is the starter workspace, not the application.

Sources: [SPEC.md](../../SPEC.md), [product overview](../product/OVERVIEW.md). Detailed stack and acceptance requirements belong to the specification; live boundaries belong to the [GitHub contract](../architecture/GITHUB_CONTRACT.md).

## Decision

Use local execution as the initial development target. Implement real local domain behavior and persistence when the build is authorized. Keep external providers behind explicit contracts so simulated scenarios and live adapters reuse the same validation, authorization, and product logic.

Keep live OAuth, installation, repository mutation, and external-service verification as separate gates. Missing credentials must not become an excuse for static-only screens or invented live success. Agent review and synthetic evidence must not be labeled human review.

## Alternatives and consequences

Requiring live GitHub setup first would introduce interactive dependencies. A static mockup would avoid them but would not verify the product loop. The selected approach permits meaningful local checks while leaving provider behavior and deployment acceptance visibly unverified until exercised.

This decision grants no permission to bypass environment policy or mutate remote repositories. Follow the exact scope of the active implementation task.

## Verification

Planning only. No application, adapter, database, or provider acceptance test has run.
