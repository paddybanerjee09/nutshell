---
id: architecture-provider-sources
date: 2026-11-26
status: active
tags: [architecture, sources, github, authentication]
---
# Architecture source references

## Context

These primary sources support provider facts in SYSTEM.md and GITHUB_CONTRACT.md. The repository shapes, local simulator, storage ownership and application policies are Nutshell design decisions. Check the current documentation and installed package behavior during implementation; a source link is not evidence of a successful live integration test.

## Decision

| ID | Primary source | Relevant fact |
| --- | --- | --- |
| GH1 | [GitHub App user access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) | User/app permission intersection, OAuth state/PKCE, expiry and revocation |
| GH2 | [GitHub App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app) | Stable IDs, current access checks, user versus installation authority, token handling |
| GH3 | [Organization repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization) | Actual role names and capability distinctions |
| GH4 | [Collaborator permissions API](https://docs.github.com/en/rest/collaborators/collaborators) | Effective grants and limits of legacy permission fields |
| GH5 | [Choosing GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app) | Endpoint/event permission boundaries and workflow-file permission |
| GH6 | [GitHub Checks API](https://docs.github.com/en/rest/guides/using-the-rest-api-to-interact-with-checks) | App-owned checks attached to commits |
| GH7 | [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) | Required checks, expected source app, plan/configuration limits |
| GH8 | [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) | Event/action schemas and permissions |
| GH9 | [Webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) | Prompt response, asynchronous processing and delivery identity |
| GH10 | [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks) | Failed deliveries are not retried automatically |
| GH11 | [Pull request API](https://docs.github.com/en/rest/pulls/pulls) | Exact PR identity, confirmed merge state, expected-head guards; queued is not merged |
| GH12 | [Git reference API](https://docs.github.com/en/rest/git/refs) | Authoritative branch references and safe non-force updates; branch policy still applies |
| AUTH1 | [Better Auth GitHub provider](https://better-auth.com/docs/authentication/github) | GitHub App configuration and account-email permission |

Before relying on refresh/encryption behavior, also check [Better Auth OAuth](https://better-auth.com/docs/concepts/oauth) and [Better Auth options](https://better-auth.com/docs/reference/options) against the installed version. GitHub App refresh behavior requires its own verification; generic provider explanations about ordinary OAuth apps are not interchangeable.

Implementation references for the selected stack are [Next.js authentication](https://nextjs.org/docs/app/guides/authentication), [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [pg-boss transaction adapters](https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md), and [pnpm workspaces](https://pnpm.io/workspaces). Use these to verify supported integration paths, not to justify unnecessary services or packages.

## Consequences

Read only the sources relevant to the active subsystem task. GitHub facts may change; record verified behavior in the relevant current note or top-level `nutshell-vault/decisions/YYYY-MM-DD-topic.md`. This source reference is not another task checkpoint or index. Remove retired guidance from `_INDEX.md` when archiving it; archived files are discovered only through explicit historical search.

PR requirements and post-merge task clearing require real remote facts and authorized operations. Provider documentation does not configure a ruleset, grant credentials, or turn a simulated PR into a source-work PR.

## Affected files

- `nutshell-vault/architecture/SYSTEM.md`, `GITHUB_CONTRACT.md` and `workflows/GIT_WORKFLOW.md`.
- Relevant provider/authentication code and focused integration tests when implementation is authorized.
- `nutshell-vault/_INDEX.md` for this note's metadata and any supersession.
