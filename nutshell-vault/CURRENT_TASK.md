---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-default-branch-indexing-2026-11-27
task_state: pr_open
task_revision: 134
repository_id: 1467144605
branch: feature/live-default-branch-indexing
base_branch: main
pr_number: 25
pr_url: https://github.com/paddybanerjee09/nutshell/pull/25
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

GitHub confirmed draft PR #25. The ingress and worker are implemented. Verify the new migration, immutable publication, invalid-head retention, receipt recovery, and epoch checks against disposable PostgreSQL with controlled provider responses.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
