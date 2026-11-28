---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-setup-proposals-2026-11-27
task_state: pr_open
task_revision: 130
repository_id: 1467144605
branch: feature/live-setup-proposals
base_branch: main
pr_number: 24
pr_url: https://github.com/paddybanerjee09/nutshell/pull/24
last_verified_head: null
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

GitHub confirmed draft PR #24. The provider, runtime, and repository setup panel are implemented. Verify immutable retry identity, stale source behavior, and PostgreSQL session and revocation checks before requesting the source check.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
