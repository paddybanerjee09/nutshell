---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: team-tasks-2026-11-27
task_state: ready_for_review
task_revision: 59
repository_id: 1467144605
branch: feature/team-tasks
base_branch: main
pr_number: 11
pr_url: https://github.com/paddybanerjee09/nutshell/pull/11
last_verified_head: 4d6a36b16732ce0df520fa5b33210f809f7a89dc
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

PR #11 passed lint, strict types, 17 focused tests, optimized build, migration on both databases, the persisted worker and signed fixture checks, and Firefox through calendar deadline persistence and two-session conflict reconciliation. Browser and service shutdown passed. Next, verify the trusted result, merge the exact source PR, and confirm canonical cleanup.

## Affected files

- [Tasks and notes context](features/tasks-notes/CONTEXT.md)
- [Permissions context](features/auth-permissions/CONTEXT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
