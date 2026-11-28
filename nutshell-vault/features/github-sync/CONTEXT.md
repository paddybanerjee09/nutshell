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

The GitHub App transport fixes requests to GitHub.com, bounds response bodies and pagination, and reports typed provider errors. User actions retain user authority through success and failure. Installation credentials use repository and permission scopes for background reads and app-owned Checks.

The adapter verifies current user access for a stable repository and installation, reads managed blobs at immutable Git revisions, and targets the observed head of an open same-repository PR for Checks. Archived repositories retain authorized read access. Check results and branch enforcement are reported separately.

Pull validation compares exact base and head tree inventories, including path additions and removals, object changes, and file modes. It loads managed text through the existing bounded blob reader. The service checks coverage and semantic declarations against trusted base policy and passes both observed revisions to Check publication. GitHub's Check targets the head SHA. The adapter rechecks the base before posting. A connected service can supply its retained accepted records. Without that evidence, validation requires historical links to resolve in the immutable base.

The fixture webhook validates the configured raw-body HMAC and accepts default-branch push deliveries through the [receipt outbox](../../decisions/2026-11-26-fixture-receipt-outbox.md). The core projector validates the immutable tree and the authenticated snapshot API returns the published revision, provider head, and status.

Local alpha verification stops its first worker and keeps the optimized web process running. It stages a test fixture tree, sends a signed delivery, and observes its committed queue record with zero attempts. A new worker must publish that exact revision on its first attempt before browser verification starts.

The setup tree builder reads the immutable base, preserves tracked owner content, and appends one delimited instructions section to `AGENTS.md`. It generates missing vault and record files, refuses conflicting managed content, and validates the resulting tree with the same projector used by the worker.

[Fixture setup](../../decisions/2026-11-26-fixture-setup-proposals.md) requires an explicit configuration grant and uses a revision-bound proposal. The setup route sends the stored merge delivery to the signed ingress and reuses the same identity on retry.

The GitHub setup adapter prepares the same managed files, creates a GitHub branch with the user's grant, and commits with the expected branch head. It targets the verified default branch from a separate setup PR and reuses observed matching proposals after a retry.

The live repository overview reads current setup through the linked user's authority. It compares an existing marked PR with the expected file bytes and single-parent commit before reporting it. Creating a proposal requires an explicit same-origin request for the displayed revision. The repository page distinguishes config files observed on GitHub from a published Nutshell index.

Simulated setup and Markdown proposals use the same changed-path validation with repository-scoped retained events. The simulated merge checks the proposed tree again. Pending setup proposals from the earlier policy can be refreshed on the same proposal after revalidation. Signed default-branch ingestion continues to validate the actual published tree.

## Consequences

The local repository page shows awaiting merge, indexing, or confirmation of the exact indexed revision. Reader sessions can view the setup state. Source-development PRs, revision-linked history, and live GitHub App behavior have separate evidence.

Controlled transport, repository, and setup tests cover authority separation, immutable managed files, permission denial, archived access, exact-head Checks, branch rules, and idempotent proposal recovery. Real OAuth consent and disposable-repository operations remain separate gates.

## Affected files

- [GITHUB_CONTRACT.md](../../architecture/GITHUB_CONTRACT.md) — provider and record semantics.
- [Local execution decision](../../decisions/2026-11-26-local-alpha-execution.md).
- [Record projector](../../../packages/core/src/repo-snapshot.ts), [fixture synchronization](../../../packages/server/src/fixture-sync.ts), and [worker](../../../apps/worker/src/main.ts).
- [Setup tree builder](../../../packages/core/src/fixture-setup-tree.ts) and [owner-content regressions](../../../packages/core/src/fixture-setup-tree.test.ts).
- [Fixture onboarding service](../../../packages/server/src/fixture-onboarding.ts) and [local browser journey](../../../scripts/local-browser.ts).
- [Fixture webhook](../../../apps/web/src/app/api/github/webhook/route.ts) and [verification journey](../../../scripts/fixture-sync-verify.ts).
- [Worker-offline fixture](../../../scripts/fixture-worker-offline.ts) and [local verification supervisor](../../../scripts/alpha.ts).
- [GitHub App transport](../../../packages/server/src/github-app-transport.ts) and [controlled transport tests](../../../packages/server/src/github-app-transport.test.ts).
- [GitHub App adapter](../../../packages/server/src/github-app.ts), [repository and Check authority](../../../packages/server/src/github-app-repository.ts), and [GitHub setup proposals](../../../packages/server/src/github-app-setup.ts).
- [Live setup route](../../../apps/web/src/app/api/repos/%5BrepositoryId%5D/github-setup/route.ts) and [repository setup panel](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/github-setup.tsx).
- [Trusted change validator](../../../packages/core/src/repository-change-validation.ts), [GitHub Check orchestration](../../../packages/server/src/github-app-validation.ts), and [simulated proposal validation](../../../packages/server/src/fixture-change-validation.ts).
