---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-index-reconciliation-2026-11-27
task_state: in_progress
task_revision: 141
repository_id: 1467144605
branch: feature/live-index-reconciliation
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
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

Guarded idle revision 140 is confirmed. Verify controlled provider behavior and real local PostgreSQL. Observe the draft PR before binding its identity.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
- [System architecture](architecture/SYSTEM.md).
