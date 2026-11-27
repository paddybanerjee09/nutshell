---
id: feature-auth-permissions
date: "2026-11-26"
status: active
tags: [feature, auth, permissions, isolation]
---

## Context

The local login creates standard Better Auth database sessions for three fixture identities. Server queries authorize repository access through active installations, local membership, and provider grants on each request.

## Decision

Follow [R-08 accounts and access](../../../SPEC.md#11-r-08-accounts-access-and-github-integration) and [R-11 security](../../../SPEC.md#14-r-11-security-and-correctness-constraints). Local personas must exercise real centralized authorization; live GitHub acceptance remains separate.

The local endpoint accepts one fixed persona identifier in a same-origin request. The server resolves the fixture user; request roles and repository IDs grant no authority. Repository pages resolve the current session and grant before returning a title or description.

## Consequences

Dedicated PostgreSQL tests covered cookie flags, session persistence, cross-repository denial, access revocation, and setup preservation of revoked grants. The live adapter and authorization on later product surfaces are tracked in [the acceptance ledger](../../runs/ACCEPTANCE.md).

## Affected files

- [SPEC.md](../../../SPEC.md) — cited requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — authority boundaries.
- [Server access and sessions](../../../packages/server/src/runtime.ts) and [integration tests](../../../packages/server/src/runtime.test.ts).
