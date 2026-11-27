---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: snapshot-workspace-2026-11-26
task_state: ready_for_review
task_revision: 29
repository_id: 1467144605
branch: feature/snapshot-workspace
base_branch: main
pr_number: 6
pr_url: https://github.com/paddybanerjee09/nutshell/pull/6
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

Windows `pnpm alpha:setup` and the final `pnpm alpha:verify` passed. The gate ran 99 tests, the optimized app, the PostgreSQL worker, Firefox with real workspace controls at six viewports, and signed fixture publication and shutdown. Confirm GitHub's trusted check and the exact PR #6 merge before guarded cleanup.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md)
- [UI guide](design/UI_GUIDE.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
