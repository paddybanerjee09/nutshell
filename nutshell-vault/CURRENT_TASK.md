---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: local-runtime-2026-11-26
task_state: ready_for_review
task_revision: 15
repository_id: 1467144605
branch: feature/local-runtime
base_branch: main
pr_number: 3
pr_url: https://github.com/paddybanerjee09/nutshell/pull/3
last_verified_head: null
lead_agent: codex-lead
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Build the executable local runtime slice: PostgreSQL migration and fixture access, database sessions, branded entry and protected repository selection, and a durable worker. The editor, graph, collaboration, and provider event ingestion are later feature slices.

## Decision

Keep database and authorization in the server package, use a separate worker process, and use Next.js App Router for web. Delegates own the server, worker and web folders. The lead owns toolchain manifests, setup and verification, and source integration.

## Consequences

The Windows verifier uses Firefox after Chromium reproduced a native exit timeout on a synthetic page. Startup cancellation reaches the web child, shutdown waits are bounded, and rollback preserves the original startup error. `pnpm alpha:verify` exited zero with 48 tests, a fresh optimized build, a persisted worker job, and Firefox sign-in, session reload, repository isolation, and shutdown. Confirm the source checks and matching PR merge before performing guarded task cleanup.

## Affected files

- [System architecture](architecture/SYSTEM.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
- `apps/web/src/serve.ts`, `scripts/local-services.ts`, `scripts/local-services.test.ts`, and `scripts/local-browser.ts`
