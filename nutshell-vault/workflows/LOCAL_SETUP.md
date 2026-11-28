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
- Verify dependency-download access, the Playwright browser for the host, and the required operating-system dependencies.
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

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Setup uses the existing project-scoped portable database when both URLs are absent. It generates separate session and fixture webhook secrets in ignored `.env` and applies Drizzle migrations and fixture inserts. Existing fixture access and persisted sessions survive repeated setup. Run setup again when updating an older database or environment file.

To initialize the Field Notes fixture, sign in as Coordinator, open Field Notes, create a setup proposal, and select **Simulate setup merge**. The repository page shows the proposal revision and the indexed merge revision. Select **Open workspace** to browse the published documents or product records. If webhook delivery fails after a simulated merge, the retry action reuses the same delivery. The Reader can view the Field Notes workspace and the Other repository user can configure Harbor Atlas.

Use `pnpm alpha:stop` to stop the supervised web and worker. The database is started independently. See the portable stop command above if it is your project's server.

Install the browser for your platform with `pnpm exec playwright install firefox` on Windows or `pnpm exec playwright install --only-shell chromium` elsewhere. When reusing this checkout's project-local browsers, set `PLAYWRIGHT_BROWSERS_PATH` to the absolute path of `.local/playwright-preflight/browsers` before installing. Run `pnpm alpha:verify`. Verification uses `nutshell_alpha_test` and binds to [http://127.0.0.1:3001](http://127.0.0.1:3001). It checks the persisted worker, receipt recovery after restart, entry flow, repository isolation, signed fixture deliveries, authorized snapshot reads, invalid-revision handling, and browser shutdown. Browser evidence goes to `.local/verification/`.

Run `pnpm alpha:reset` to restore the generated verification scenario after verification stops. It uses the configured test database and accepts no target argument. To repeat the restart proof with an existing optimized verification build, run `pnpm exec node scripts/alpha.ts verify-worker`.

On this Windows host, Chromium's native child stayed alive after the browser connection closed, including with a synthetic page and a direct DevTools connection. Playwright Firefox exited successfully in the independent Windows probe. The verifier uses Firefox on Windows. It closes its own test pages, disconnects the Playwright client, and checks graceful native browser shutdown separately from the browser journey. See the [acceptance ledger](../runs/ACCEPTANCE.md#decision) for the application checks.

If Windows runs out of native memory during the Turbopack build, use a temporary PowerShell session for the supported Webpack production build and scoped worker verification. Typechecking remains enabled in the build. Record both results in the acceptance ledger. [Next.js bundler options](https://nextjs.org/docs/app/api-reference/turbopack#using-webpack-instead).

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=768 --max-semi-space-size=8'
pnpm.cmd --filter '@nutshell/web' exec next build --webpack
pnpm.cmd exec node scripts/alpha.ts verify-worker
```

The Windows optimized build uses two Next.js page-data workers after a worker exited with code `3221226505` during an eleven-worker build. Next.js selects the configured worker limit at build time. [Next.js build source](https://github.com/vercel/next.js/blob/canary/packages/next/src/build/index.ts)

Verification runs the test files in sequence because PostgreSQL integration tests change shared fixture grants and connection epochs. On Windows, Vitest uses worker threads to avoid the observed fork shutdown timeouts.

The verification database lease checks the configured URL and the connected database name and loopback address. Setup, verification, and fixture reset use the same PostgreSQL advisory lock. The reset transaction validates the original fixture repositories and personas before clearing generated scenario state, refreshing connection epochs, and restoring seed grants. This preserves unrelated repositories, jobs, and screenshot assets.

Web startup reports the failed phase and waits for HTTP 200 from its own loopback health route before signalling readiness. Transient unavailability permits up to three checks within the supervisor deadline. Provisioning and migration each allow 15 seconds per local connection. The PostgreSQL integration suites use explicit setup, test, and cleanup deadlines.

The pinned runtime uses Node 24.18.0, pnpm 11.25.0, PostgreSQL 18.7, Next.js 16.4.6, Better Auth 1.7.28, Drizzle 0.45.4, and pg-boss 12.40.0.

The workspace graphs use React Flow 13.0.3 with d3-force 3.0.1. The lockfile pins the graph and editor dependencies used by the app. [React Flow layout guide](https://reactflow.dev/learn/layouting/layouting) and [d3-force reference](https://d3js.org/d3-force).

### Configure the product runtime separately

[.env.example](../../.env.example) records local mode, deployment, origin, dedicated database URLs, session secrets, and the GitHub App credential names.

Local-alpha product operation requires real PostgreSQL, sessions, authorization, and durable jobs, but no product GitHub App or cloud storage account. The development source PR gate remains mandatory. Optimized local builds may use synthetic providers; hosted mode rejects them, and missing live configuration fails closed.

For separately authorized live product acceptance, supply the registered development GitHub App, exact disposable repositories/operations, completed consents, backend credentials, and configured reachable callback/webhook endpoints. Follow [GITHUB_CONTRACT.md](../architecture/GITHUB_CONTRACT.md). Without these, implement the adapter and controlled contract tests; leave live acceptance not run.

Configured GitHub sign-in requires `NUTSHELL_MODE=live`, explicit `NUTSHELL_DEPLOYMENT`, an HTTPS `NUTSHELL_ORIGIN`, a separate `DATABASE_URL`, and `BETTER_AUTH_SECRET`. Set `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_APP_WEBHOOK_SECRET` in the server environment. The GitHub App callback is the configured origin plus `/api/auth/callback/github`. Enable expiring user access tokens and use the permission list in the contract.

With the live environment loaded, run `node scripts/live-migrate.ts` to migrate the separately provisioned database without seeding local identities. Build with `pnpm --filter @nutshell/web build`. For a loopback origin behind configured HTTPS termination, run `pnpm --filter @nutshell/web exec next start --hostname 127.0.0.1 --port 3000` and forward the configured Host. In a separate terminal with the same environment, run `node apps/worker/src/main.ts`. `alpha:setup` and `alpha:dev` use local-alpha configuration.

After GitHub sign-in, choose **Find GitHub repositories**. The **Install Nutshell on GitHub** action opens the verified App's installation page. The App's optional setup URL can return to the configured origin plus `/app`. Refresh discovery after installation, select the private repository, and choose **Connect repository**. A current repository administrator can establish the association. On the repository overview, **Create setup pull request** opens a proposal against the displayed source revision. Review and merge it in GitHub under the repository's rules. The overview shows the checked proposal or the source revision containing Nutshell files.

Set the GitHub App webhook URL to the configured origin plus `/api/github/webhook`, match `GITHUB_APP_WEBHOOK_SECRET`, and subscribe to `push`. This ingress accepts bodies up to 1 MiB. For an existing revision, missed delivery, or a job that exhausted its retries, an administrator can select **Index current revision** and then **Check indexing status**. A queued request names the exact provider revision. After successful publication the overview shows **Open workspace** for indexed notes and graphs. An invalid head retains the previous valid revision for current authorized users.

Inspect `github_push_delivery` for terminal `failed` jobs and their source, and `github_index_state` for validation errors and retained revisions. Restarting the worker resumes queued work. Redelivery of the same accepted GitHub ID is idempotent. A subsequent signed push or a fresh administrator request can schedule work again. Live editing has separate acceptance.

Subscribe to `repository` with `push`. GitHub sends installation, repository selection, and app authorization lifecycle deliveries to GitHub Apps automatically. Inspect `github_revocation_delivery` by delivery ID after a negative lifecycle event. If a write fails or times out, redeliver the exact event from GitHub after the database recovers. For changes without removed repository IDs, current GitHub access checks still govern reads and indexing. Re-enabling a disabled association and migrating private workspace data after transfer require a separate verified operation. [GitHub webhook event reference](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Subscribe to `pull_request` for the worker to publish the **Nutshell validation** Check. Open, reopen, synchronize, or mark ready an open same-repository pull request targeting the canonical default branch. Inspect `github_pull_check_delivery` by delivery ID for its exact comparison, Check identity, result, or retry exhaustion. A later base or head change requires a fresh comparison. GitHub rules independently determine merge requirements and bypass authority. [GitHub pull request events](https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request).

## Consequences

Feature work begins only after real source PR preflight is ready. Optional live product credentials do not block that local product target, and simulated customer-repository events cannot establish real development PR completion.

On resume, follow router-first order, then reconcile CURRENT_TASK with Git/service state. Keep observed application and provider verification in the acceptance ledger.

## Affected files

- [SPEC.md](../../SPEC.md) — command requirements and gates.
- [_INDEX.md](../_INDEX.md), [CURRENT_TASK.md](../CURRENT_TASK.md), and [GIT_WORKFLOW.md](GIT_WORKFLOW.md).
- [ACCEPTANCE.md](../runs/ACCEPTANCE.md) — observed verification only.
- [Local command implementation](../../scripts/alpha.ts) and [environment example](../../.env.example).
