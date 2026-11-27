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

The GitHub App auth adapter configures HTTPS-only Better Auth sessions, S256 PKCE, origin-bound sign-in, and encrypted provider account credentials. Its PostgreSQL token store locks the account row before refresh and persists both rotated credentials together. GitHub App settings are independent from source-development credentials.

## Consequences

Dedicated PostgreSQL tests covered cookie flags, session persistence, cross-repository denial, access revocation, and setup preservation of revoked grants. The live adapter and authorization on later product surfaces are tracked in [the acceptance ledger](../../runs/ACCEPTANCE.md).

Controlled Better Auth HTTP and refresh tests cover valid and rejected state binding, encrypted storage, credential expiry, rotation, and disabled browser token endpoints. Configured application routes and external OAuth consent require separate verification.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — authority boundaries.
- [Server access and sessions](../../../packages/server/src/runtime.ts) and [integration tests](../../../packages/server/src/runtime.test.ts).
- [GitHub App auth](../../../packages/server/src/github-app-auth.ts), [account token storage](../../../packages/server/src/github-app-auth-tokens.ts), and [controlled auth tests](../../../packages/server/src/github-app-auth.test.ts).
