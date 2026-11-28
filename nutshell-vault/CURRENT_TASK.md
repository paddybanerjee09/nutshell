---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-index-reconciliation-2026-11-27
task_state: ready_for_review
task_revision: 143
repository_id: 1467144605
branch: feature/live-index-reconciliation
base_branch: main
pr_number: 27
pr_url: https://github.com/paddybanerjee09/nutshell/pull/27
last_verified_head: 2d23e6196c015303fed1aebb2c7546c347fce10f
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Live index reconciliation

## Context

Let a verified administrator schedule indexing for the current GitHub revision when a push was missed or a prior job failed.

## Decision

Recheck the exact current user, repository and provider ref, then queue manual work with its own source and exact epoch. Reuse the durable worker, immutable validators, and last-good publication rules.

## Consequences

The 66 scoped cases, strict checks, optimized Webpack build, actual local app and worker restart, and migration passed. Turbopack hit native Windows resource errors. Observe the exact trusted GitHub check, merge PR #27, and apply guarded cleanup.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
- [System architecture](architecture/SYSTEM.md).
