---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-access-revocation-2026-11-27
task_state: ready_for_review
task_revision: 147
repository_id: 1467144605
branch: feature/live-access-revocation
base_branch: main
pr_number: 28
pr_url: https://github.com/paddybanerjee09/nutshell/pull/28
last_verified_head: dd441d8a8ce5548f03b60fa70f07de2529a66999
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Signed live access revocation

## Context

Use signed GitHub events to invalidate exact local installation, repository, and user access scopes without losing private data.

## Decision

Record negative lifecycle deliveries and revoke affected associations atomically. Bump repository epochs so queued jobs cannot publish and never restore access from a replayed event.

## Consequences

The 64 scoped tests, strict checks, optimized Webpack build, and actual local app and worker restart passed. Disposable PostgreSQL confirmed idempotent revocation, more than 500 explicit repository IDs, and old-epoch work denial. Both local databases migrated. Observe the exact trusted source check, merge PR #28, and perform guarded cleanup.

## Affected files

- [Authorization context](features/auth-permissions/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
