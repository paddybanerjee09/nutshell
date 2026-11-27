---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: team-notes-2026-11-27
task_state: in_progress
task_revision: 61
repository_id: "1467144605"
branch: feature/team-notes
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Implement repository-scoped structured team notes with bounded Tiptap JSON, PostgreSQL persistence, creator or coordinator edits, and conflict recovery across sessions.

## Decision

The service delegate owns collaboration storage and PostgreSQL tests. The HTTP delegate owns shared content validation and routes. The UI delegate owns the Team notes panel, editor, and workspace integration. The lead owns the lockfile, browser verification, memory, and source integration in this checkout.

## Consequences

Team tasks merged and canonical cleanup was confirmed at revision 60. The next action is to open this feature's draft source PR and exercise notes through local browser sessions and the database.

## Affected files

- [Collaboration context](features/tasks-notes/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
