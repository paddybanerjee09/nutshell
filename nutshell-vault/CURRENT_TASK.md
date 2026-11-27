---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: local-runtime-2026-11-26
task_state: ready_for_review
task_revision: 11
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

Repeated setup, development health/start/stop, PostgreSQL session isolation, durable worker restart, and optimized browser entry checks ran locally. The HTTP auth route now binds to the configured loopback origin after checking Host. Run the exact committed head through alpha:verify and GitHub's trusted status before merge.

## Affected files

- [System architecture](architecture/SYSTEM.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- `apps/web/`, `apps/worker/`, and `packages/server/`
