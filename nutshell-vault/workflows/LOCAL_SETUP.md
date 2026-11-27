---
id: workflow-local-setup
date: "2026-11-26"
status: active
tags: [workflow, setup, preflight, local-alpha, pull-requests]
---

## Context

This is the planned local setup procedure. No application environment has been installed or tested by creating this starter. [SPEC.md](../../SPEC.md) owns the required commands and acceptance gates.

Two GitHub relationships are distinct: the real development source repository requires authentication and feature-PR capability before feature work; Nutshell's optional live product GitHub App connects customer/test repositories. Local product fixtures do not satisfy the development PR gate.

## Decision

### Read and establish the source PR gate

After normal root AGENTS instructions, read [_INDEX.md](../_INDEX.md) first, then [CURRENT_TASK.md](../CURRENT_TASK.md). Follow the specification's first-run or bounded-task reading rule.

Before any feature implementation, verify the exact development repository/remote, GitHub authentication, configured Git author identity, and authority for its feature branches and real PRs. Establish permitted branch-push/PR-creation operations, existing required checks/reviews, and an authorized merge/cleanup route under [GIT_WORKFLOW.md](GIT_WORKFLOW.md). Do not invent identity, infer broad permission from a token, or weaken repository protections.

If source-repository access, authentication, or required PR capability is unavailable, record the blocked preflight in CURRENT_TASK. Do not begin feature implementation. Independent environment setup and diagnosis may continue; a local commit or simulated PR is not a substitute. Complete one-time account/consent or installer steps before an unattended feature run when those steps require the user.

### Check the local environment

- Open the actual local checkout in Codex; select the intended model/effort and permitted client execution mode.
- Complete Codex sign-in/project trust as needed. Inspect existing instructions, overrides, branch/worktree, and unrelated user changes.
- Verify a supported Node LTS runtime; select compatible stable dependencies and pin actual Node/pnpm/dependency versions and the lockfile.
- Provide local PostgreSQL through a native installation or available Docker setup. Verify connectivity and restart behavior; do not assume Docker or WSL exists.
- Verify dependency-download access, Playwright Chromium, and required operating-system dependencies.
- Verify project writes, permitted Git operations, app ports, and scoped database/media directories.
- Keep the machine awake and session online during the run. Use PowerShell-compatible or cross-platform scripts for Windows.

Resolve allowed preflight problems. Client permissions are separate from these documents; a no-prompt setting does not supply missing capability. Do not evade a denied operation.

### Implement and document commands

| Command | Current state |
| --- | --- |
| pnpm alpha:setup | Not implemented; must provide idempotent setup/migration/seed |
| pnpm alpha:dev | Not implemented; must start local web/worker on loopback |
| pnpm alpha:verify | Not implemented; must use separate test resources |
| pnpm alpha:stop | Not implemented; must stop only project processes |
| pnpm alpha:reset | Not implemented; must validate explicit generated-fixture targets |

As commands become real, record exact tested invocation, runtime versions, URLs, process behavior, and recovery. Do not claim a command or test exists before implementation.

### Configure the product runtime separately

The future .env.example must document NUTSHELL_MODE=local-alpha|live, NUTSHELL_DEPLOYMENT=local|hosted, separate development/test database URLs, origin/port, scoped assets, session/encryption secrets, and optional live product GitHub settings. Keep generated secrets in ignored local files.

Local-alpha product operation requires real PostgreSQL, sessions, authorization, and durable jobs, but no product GitHub App or cloud storage account. The development source PR gate remains mandatory. Optimized local builds may use synthetic providers; hosted mode rejects them, and missing live configuration fails closed.

For separately authorized live product acceptance, supply the registered development GitHub App, exact disposable repositories/operations, completed consents, backend credentials, and configured reachable callback/webhook endpoints. Follow [GITHUB_CONTRACT.md](../architecture/GITHUB_CONTRACT.md). Without these, implement the adapter and controlled contract tests; leave live acceptance not run.

## Consequences

Feature work begins only after real source PR preflight is ready. Optional live product credentials do not block that local product target, and simulated customer-repository events cannot establish real development PR completion.

On resume, follow router-first order, then reconcile CURRENT_TASK with Git/service state. Verify changed behavior without repeating unrelated checks unnecessarily. Preserve truthful evidence and unresolved prerequisites. No application tests, PRs, or provider acceptance are asserted by this document.

## Affected files

- [SPEC.md](../../SPEC.md) — command requirements and gates.
- [_INDEX.md](../_INDEX.md), [CURRENT_TASK.md](../CURRENT_TASK.md), and [GIT_WORKFLOW.md](GIT_WORKFLOW.md).
- [ACCEPTANCE.md](../runs/ACCEPTANCE.md) — observed verification only.
- Future package scripts and .env.example when implemented; no runtime files are supplied by this note.
