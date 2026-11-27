---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: managed-markdown-creation-2026-11-27
task_state: in_progress
task_revision: 117
repository_id: 1467144605
branch: feature/managed-markdown-creation
base_branch: main
pr_number: null
pr_url: null
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

Canonical idle revision 116 is confirmed. The server delegate owns absent-source storage, draft creation/listing and proposal integration. The lead owns the shared index-row helper, workspace controls, browser verification and source workflow.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md).
- [UI guide](design/UI_GUIDE.md).
- [Provider contract](architecture/GITHUB_CONTRACT.md).
