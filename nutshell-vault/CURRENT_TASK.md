---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-setup-proposals-2026-11-27
task_state: in_progress
task_revision: 129
repository_id: 1467144605
branch: feature/live-setup-proposals
base_branch: main
pr_number: null
pr_url: null
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

Canonical idle revision 128 is confirmed. The runtime delegate owns current authorization and server integration. The lead owns provider read/status and expected identity guard, HTTP and UI, controlled verification, and source workflow.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
