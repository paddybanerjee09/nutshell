---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: managed-markdown-creation-2026-11-27
task_state: ready_for_review
task_revision: 121
repository_id: 1467144605
branch: feature/managed-markdown-creation
base_branch: main
pr_number: 22
pr_url: https://github.com/paddybanerjee09/nutshell/pull/22
last_verified_head: 76c0f76fb8d1d2a0fd625d57c93d318d33b2b1d0
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Managed Markdown creation

## Context

Create a managed Markdown note as a private draft from an explicitly absent source, then publish it with its index row through a checked simulated proposal.

## Decision

Reuse workspace editing and the current repository grants, guard the expected base and absent path, and preserve catalog bytes outside the new row. Reuse source and fixture checks for canonical publication.

## Consequences

Migration 0010 applied on both local databases. The full Windows verification exited zero with 279 tests, the optimized app, persisted worker restart, full Firefox journey and scoped shutdown. Firefox preserved the private note after reload and indexed the exact file and catalog row through the simulated proposal. Confirm the latest trusted source check, then merge and clear only this task.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md).
- [UI guide](design/UI_GUIDE.md).
- [Provider contract](architecture/GITHUB_CONTRACT.md).
