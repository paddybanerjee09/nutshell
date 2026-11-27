---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: team-tasks-2026-11-27
task_state: pr_open
task_revision: 58
repository_id: 1467144605
branch: feature/team-tasks
base_branch: main
pr_number: 11
pr_url: https://github.com/paddybanerjee09/nutshell/pull/11
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Repository team tasks

## Context

Persist repository tasks with one eligible assignee, date-only deadlines, status and blocker reasons, linked entity IDs, and copyable source-linked briefs.

## Decision

Use current repository read authorization for access and self-assignment. Apply creator, assignee, and verified collaboration management rules in the server transaction. Optimistic revisions preserve attempted edits on conflicts.

## Consequences

Source PR #11 has tested PostgreSQL persistence, role-aware assignment, and versioned writes. Two database tests and four HTTP route tests passed. Team tasks workspace controls are integrated. Both local databases have migration 0005 and the optimized build passed. Firefox exposed ambiguous implicit select labels. The editor now names the controls explicitly, and the verifier closes its own pages with bounded cleanup when a journey fails. Firefox passed the task creation, two-session status conflict, reconciliation, and reload assertions. The verifier now disconnects its own Playwright client before native server shutdown. Rerun the complete local journey to confirm graceful termination.

## Affected files

- [Tasks and notes context](features/tasks-notes/CONTEXT.md)
- [Permissions context](features/auth-permissions/CONTEXT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
