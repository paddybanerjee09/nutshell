---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-default-branch-indexing-2026-11-27
task_state: ready_for_review
task_revision: 135
repository_id: 1467144605
branch: feature/live-default-branch-indexing
base_branch: main
pr_number: 25
pr_url: https://github.com/paddybanerjee09/nutshell/pull/25
last_verified_head: 910353f6e43a00235d95b5eb8101f84178e2e961
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

Fifty scoped cases passed with controlled GitHub responses and disposable PostgreSQL. The actual live-mode worker started and stopped under synthetic configuration. The full Windows retry passed 322 tests, optimized app, PostgreSQL worker recovery, signed fixtures, Firefox, and shutdown. Observe the exact trusted source check, merge PR #25, then perform canonical cleanup.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
