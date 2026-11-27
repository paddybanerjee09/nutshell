---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: markdown-drafts-2026-11-27
task_state: pr_open
task_revision: 39
repository_id: 1467144605
branch: feature/markdown-drafts
base_branch: main
pr_number: 8
pr_url: https://github.com/paddybanerjee09/nutshell/pull/8
last_verified_head: null
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

Source PR #8 has the draft API and CodeMirror workspace. The optimized build, persisted-worker probe, and focused editor and PostgreSQL checks passed. The optimized Firefox walkthrough verified source decorations, undo and redo, shared edits, persistence after reload, conflict preservation, reader denial, and shutdown. Keep draft status and Save visible while scrolling. Next, rerun the complete gate against the exact code and tests.

## Affected files

- Workspace editor and draft API in `apps/web`
- Fixture draft authorization, migration, and tests in `packages/server`
- [Workspace context](features/workspace-editor/CONTEXT.md)
- [Acceptance evidence](runs/ACCEPTANCE.md)
