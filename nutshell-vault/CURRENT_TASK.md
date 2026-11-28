---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-default-branch-indexing-2026-11-27
task_state: in_progress
task_revision: 133
repository_id: 1467144605
branch: feature/live-default-branch-indexing
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Live default-branch indexing

## Context

Index an associated private GitHub repository after a signed default-branch push.

## Decision

Enqueue an epoch-bound receipt before acknowledgement. The worker verifies the active installation and exact repository and owner, reads a single immutable revision, applies the shared validators, and publishes only against the verified current ref.

## Consequences

Guarded idle revision 132 is confirmed. Live ingress and worker/index evidence will use controlled GitHub responses and real local PostgreSQL. Observe the draft PR before binding its identity.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
