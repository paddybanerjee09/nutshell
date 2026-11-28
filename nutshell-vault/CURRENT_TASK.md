---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: authorized-live-workspace-2026-11-27
task_state: in_progress
task_revision: 137
repository_id: 1467144605
branch: feature/authorized-live-workspace
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Authorized live workspace

## Context

Expose live GitHub indexed Markdown, product entities, and graphs through the existing workspace.

## Decision

Authorize the exact current session, linked user, and active installation association before returning cached knowledge. Join the published projection on current epoch and report pending, current, stale, or invalid from the verified provider head. Reuse the workspace rendering and expose actions supported by the configured provider.

## Consequences

Guarded idle revision 136 is confirmed. The runtime and workspace surfaces will be covered with controlled GitHub responses. Observe the draft PR before binding its identity.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md).
- [Authorization context](features/auth-permissions/CONTEXT.md).
- [GitHub synchronization](features/github-sync/CONTEXT.md).
