---
id: workflow-local-setup
date: "2026-11-26"
status: active
tags: [workflow, setup, preflight, local-alpha, pull-requests]
---

## Context

This note records the local infrastructure preflight and tracks application startup as implementation proceeds. [SPEC.md](../../SPEC.md) owns the required commands and acceptance gates.

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

### Observed on the Windows development machine

- Git 2.54.0.windows.1 and Git Credential Manager 2.7.3 authenticated to the source repository. GitHub reported repository ID 1467144605, default branch `main`, and push authority. The first branch push and [draft PR #1](https://github.com/paddybanerjee09/nutshell/pull/1) succeeded. Branch protection, applicable rulesets, required status checks, and Actions workflows were absent at preflight. The owner authorized verified feature merges and expected-head, task-file-only cleanup on `main`.
- Node 24.18.0, npm 11.16.0, and pnpm 11.25.0 ran locally. The npm registry and GitHub API returned HTTP 200 when reached through approved host execution. Next.js lists Windows and Node 20.9 or later in its [system requirements](https://nextjs.org/docs/app/getting-started/installation#system-requirements).
- Playwright 1.65.1 installed Chrome Headless Shell 159.0.8154.6 under `.local/playwright-preflight/browsers`. A headless smoke test filled a form, clicked a button, and verified the DOM update. See the [Playwright browser installation guide](https://playwright.dev/docs/browsers).
- PostgreSQL 18.7 ran from the official Windows binaries in `.local/postgres-18.7` after a SHA-256 check. A SCRAM-authenticated query connected over loopback on port 55432, inserted a test row, and verified its value after restart. The probe removed its table and stopped PostgreSQL. The host execution was approved after the default sandbox could not create the Windows restricted token for `pg_ctl`. See the [PostgreSQL Windows distributions](https://www.postgresql.org/download/windows/).

Start, connect to, and stop that existing project-scoped PostgreSQL instance from the workspace in PowerShell:

```powershell
$pg = (Resolve-Path ./.local/postgres-18.7).Path
& "$pg/pgsql/bin/pg_ctl.exe" -D "$pg/data" -l "$pg/postgres.log" -w start
$env:PGPASSFILE = "$pg/pgpass.conf"
& "$pg/pgsql/bin/psql.exe" -X -w -h 127.0.0.1 -p 55432 -U nutshell_local -d postgres
& "$pg/pgsql/bin/pg_ctl.exe" -D "$pg/data" -w -m fast stop
```

These checks cover the database and browser prerequisites. Application migration, browser journeys, and worker startup have their own acceptance gates.

### Start the local runtime

Start your PostgreSQL server first. For this checkout use the portable startup command above. For another local installation, set `DATABASE_URL` and `TEST_DATABASE_URL` for `nutshell_alpha` and `nutshell_alpha_test` on loopback. Use an account that can create these dedicated databases and apply migrations, or provision both databases in advance.

```powershell
pnpm install --frozen-lockfile
pnpm alpha:setup
pnpm alpha:dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Setup uses the existing project-scoped portable database when both URLs are absent. It generates a session secret in ignored `.env` and applies Drizzle migrations and fixture inserts. Existing fixture access and persisted sessions survive repeated setup.

Use `pnpm alpha:stop` to stop the supervised web and worker. The database is started independently. See the portable stop command above if it is your project's server.

Install the browser for your platform with `pnpm exec playwright install firefox` on Windows or `pnpm exec playwright install --only-shell chromium` elsewhere. When reusing this checkout's project-local browsers, set `PLAYWRIGHT_BROWSERS_PATH` to the absolute path of `.local/playwright-preflight/browsers` before installing. Run `pnpm alpha:verify`. The optimized verification process uses `nutshell_alpha_test` and binds to [http://127.0.0.1:3001](http://127.0.0.1:3001). It checks the entry flow, repository isolation, a persisted worker probe, and browser shutdown. The test output goes to `.local/verification/`. The fixture reset command remains planned.

On this Windows host, Chromium's native child stayed alive after the browser connection closed, including with a synthetic page and a direct DevTools connection. Playwright Firefox exited successfully in the independent Windows probe. The verifier uses Firefox on Windows and reports a failed check if graceful browser shutdown cannot be confirmed. See the [acceptance ledger](../runs/ACCEPTANCE.md#decision) for the application checks.

The pinned runtime uses Node 24.18.0, pnpm 11.25.0, PostgreSQL 18.7, Next.js 16.4.6, Better Auth 1.7.28, Drizzle 0.45.4, and pg-boss 12.40.0.

### Configure the product runtime separately

[.env.example](../../.env.example) records the current local mode, deployment, origin, dedicated database URLs, and session secret setting. Live product credentials and private asset settings belong with those integration slices.

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
