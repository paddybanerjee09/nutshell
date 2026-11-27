---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: local-runtime-2026-11-26
task_state: blocked
task_revision: 13
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

The runtime started and stopped cleanly in the first development check. On PR #3's runnable head, 46 tests, the optimized build, the persisted worker probe, and Chromium assertions passed. Browser teardown then stalled and reproduced with bundled Chromium, Edge, and Chrome on synthetic pages. The bounded verifier reports the timeout. A later development restart also failed before readiness and reported a child termination timeout. PostgreSQL remains running; the web and worker are stopped. Keep PR #3 in draft and rerun local verification when the host can start and stop the child processes reliably.

## Affected files

- [System architecture](architecture/SYSTEM.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- `apps/web/`, `apps/worker/`, and `packages/server/`
