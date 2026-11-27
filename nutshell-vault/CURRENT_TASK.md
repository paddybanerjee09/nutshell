---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: managed-markdown-creation-2026-11-27
task_state: pr_open
task_revision: 120
repository_id: 1467144605
branch: feature/managed-markdown-creation
base_branch: main
pr_number: 22
pr_url: https://github.com/paddybanerjee09/nutshell/pull/22
last_verified_head: null
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

Migration 0010 applied on both local databases. Seventeen targeted checks passed for the vault, PostgreSQL proposal and draft stores, and HTTP privacy. The form now opens the saved private draft in a workspace pane and restores it after reload. Run the integrated optimized browser and source checks.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md).
- [UI guide](design/UI_GUIDE.md).
- [Provider contract](architecture/GITHUB_CONTRACT.md).
