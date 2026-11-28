---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-setup-proposals-2026-11-27
task_state: ready_for_review
task_revision: 131
repository_id: 1467144605
branch: feature/live-setup-proposals
base_branch: main
pr_number: 24
pr_url: https://github.com/paddybanerjee09/nutshell/pull/24
last_verified_head: 0680d1957b7eca581517aef6f3563b4e6a6322ed
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Live setup proposals

## Context

Allow a currently verified repository administrator to open the setup pull request and show its provider-observed status after reload.

## Decision

Reuse the checked user-token setup adapter and active local association. Recheck exact user, installation, owner and repository identity before setup. Display the provider's open PR separately from indexed source.

## Consequences

The 46 scoped tests and full Windows verifier passed. The full run exercised 299 tests, the optimized web app, PostgreSQL worker recovery, signed fixture deliveries, Firefox, and shutdown. Product GitHub requests used controlled contract tests. Confirm the exact trusted source check, merge PR #24, and run canonical guarded cleanup.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
