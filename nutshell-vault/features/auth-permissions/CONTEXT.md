---
id: feature-auth-permissions
date: "2026-11-26"
status: planned
tags: [feature, auth, permissions, isolation]
---

## Context

Planned feature only. No session, authorization implementation, or verification is recorded. This feature covers identities, sessions, repository access, and isolation.

## Decision

Follow [R-08 accounts and access](../../../SPEC.md#11-r-08-accounts-access-and-github-integration) and [R-11 security](../../../SPEC.md#14-r-11-security-and-correctness-constraints). Local personas must exercise real centralized authorization; live GitHub acceptance remains separate.

## Consequences

Do not treat synthetic identity as a bypass or simulated evidence as live acceptance. Relevant gates: A04, A05, A22. Implementation/source-test mappings will be recorded when established.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — authority boundaries.
- Actual implementation and test files: not established.
