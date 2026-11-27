---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: local-runtime-2026-11-26
task_state: in_progress
task_revision: 9
repository_id: 1467144605
branch: feature/local-runtime
base_branch: main
pr_number: null
pr_url: null
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

PR #2 merged and GitHub confirmed canonical idle at revision 8 after an expected-head write. Verify this runtime with the local database, browser and worker, then exercise the trusted GitHub source check on the final feature head.

## Affected files

- [System architecture](architecture/SYSTEM.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- `apps/web/`, `apps/worker/`, and `packages/server/`
