---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: snapshot-workspace-2026-11-26
task_state: in_progress
task_revision: 26
repository_id: 1467144605
branch: feature/snapshot-workspace
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: codex-lead
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Open the authorized indexed repository documents and records in a read-only workspace with the specified ribbon, status bar, and responsive pane layout.

## Decision

Use the published snapshot for document and record content. Keep tabs and split state in a versioned, bounded user and repository preference. Apply the canonical UI guide and preserve the original logo.

## Consequences

PR #5 merged and its guarded cleanup confirmed idle revision 25. Open the source draft before integrating workspace data, pane controls, and responsive browser verification.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md)
- [UI guide](design/UI_GUIDE.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
