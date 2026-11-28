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

Live repository authorization matches the current GitHub user to their linked account and compares the observed repository, installation, owner, and node identities with the active local association. The resolver reuses results only within the same request and exact connection epoch. The caller rechecks active local facts before disclosure.

The configured runtime selects the GitHub Better Auth handler in live mode and excludes the local persona plugin. Live connections use a separate PostgreSQL database. The default repository list and overview disclose only currently authorized local associations. Discovery is a separate live-only action on the repository list, and connection requests require the configured origin and exact numeric targets. The fixture worker and local tooling require local-alpha configuration.

The browser starts GitHub authorization with a same-origin POST and accepts only the configured GitHub OAuth destination and callback. Unavailable live authorization exposes a generic reconnect state. Local persona controls are rendered only in local-alpha mode.

GitHub repository discovery matches the App's JWT-authenticated identity and uses the linked user's token to list installations and readable private repositories. It bounds pagination and excludes suspended installations and mismatched owners. The install link uses the verified App slug and the fixed GitHub.com destination. [GitHub App installation API](https://docs.github.com/en/rest/apps/installations?apiVersion=2026-03-10) and [installation URL format](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party).

An explicit connection revalidates current user access before any local write. The transaction checks the session and linked GitHub account again and locks stable local connection state. A current administrator can create a missing association. A reader can add a missing membership to the same active association. Revoked memberships, inactive connections, changed epochs, and different owners or node identities fail closed. Existing associations and their private collaboration records stay scoped to their original owner.

## Consequences

Dedicated PostgreSQL tests covered cookie flags, session persistence, cross-repository denial, access revocation, and setup preservation of revoked grants. The live adapter and authorization on later product surfaces are tracked in [the acceptance ledger](../../runs/ACCEPTANCE.md).

Controlled Better Auth HTTP and refresh tests cover valid and rejected state binding, encrypted storage, credential expiry, rotation, and disabled browser token endpoints. External OAuth consent, setup proposal publication, and indexed live workspace use have separate evidence.

Controlled authorization tests cover mismatched accounts, provider denial, ownership transfer, reconnects, and revocation between requests.

## Affected files

- [SPEC.md](../../../SPEC.md) — cited requirements.
- [SYSTEM.md](../../architecture/SYSTEM.md) and [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — authority boundaries.
- [Server access and sessions](../../../packages/server/src/runtime.ts) and [integration tests](../../../packages/server/src/runtime.test.ts).
- [GitHub App auth](../../../packages/server/src/github-app-auth.ts), [account token storage](../../../packages/server/src/github-app-auth-tokens.ts), and [controlled auth tests](../../../packages/server/src/github-app-auth.test.ts).
- [Current GitHub authorization](../../../packages/server/src/github-live-access.ts) and [controlled authorization tests](../../../packages/server/src/github-live-access.test.ts).
- [Verified local connections](../../../packages/server/src/github-live-onboarding.ts) and [connection route](../../../apps/web/src/app/api/github/connections/route.ts).
- [Runtime configuration](../../../packages/server/src/config.ts), [unseeded live migration](../../../scripts/live-migrate.ts), and [local and live setup](../../workflows/LOCAL_SETUP.md).
- [Sign-in page](../../../apps/web/src/app/login/page.tsx), [GitHub authorization request](../../../apps/web/src/app/login/github-sign-in-request.ts), and [entry surface tests](../../../apps/web/src/app/entry-surfaces.test.tsx).
