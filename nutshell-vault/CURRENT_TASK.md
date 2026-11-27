---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: markdown-drafts-2026-11-27
task_state: ready_for_review
task_revision: 41
repository_id: 1467144605
branch: feature/markdown-drafts
base_branch: main
pr_number: 8
pr_url: https://github.com/paddybanerjee09/nutshell/pull/8
last_verified_head: e8e790ced929437e1ca287b0b328064659604633
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Markdown editing and private drafts

## Context

Implement CodeMirror source and live preview in the indexed workspace. Persist private drafts for authorized repository writers with optimistic draft and source revision checks.

## Decision

Decorations are a view over Markdown source. Read remains the default view. Saving drafts does not modify a repository or its canonical indexed memory.

## Consequences

Source PR #8 has the draft API and CodeMirror workspace. The optimized build, persisted-worker probe, and focused editor and PostgreSQL checks passed. The optimized Firefox walkthrough verified source decorations, undo and redo, shared edits, persistence after reload, conflict preservation, reader denial, and shutdown. The first rerun reached all 124 tests and found that a retained browser draft collided with the database test path. A new indexed test note isolated each run and passed against the same database. Windows alpha:verify exited zero on the recorded code head with 124 tests, optimized build, a persisted worker job, the signed fixtures, Firefox editing and draft checks, and service shutdown. The primary local database migration also passed. Next, confirm the trusted source check on the exact PR head and merge, then clean up the canonical task.

## Affected files

- Workspace editor and draft API in `apps/web`
- Fixture draft authorization, migration, and tests in `packages/server`
- [Workspace context](features/workspace-editor/CONTEXT.md)
- [Acceptance evidence](runs/ACCEPTANCE.md)
