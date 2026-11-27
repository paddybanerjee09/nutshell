---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: markdown-drafts-2026-11-27
task_state: in_progress
task_revision: 35
repository_id: 1467144605
branch: feature/markdown-drafts
base_branch: main
pr_number: null
pr_url: null
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

Source preflight and canonical idle revision 34 are verified. Next, open the feature PR, integrate editor and draft storage, and exercise the workflow with PostgreSQL and Firefox.

## Affected files

- Workspace editor and draft API in `apps/web`
- Fixture draft authorization, migration, and tests in `packages/server`
- [Workspace context](features/workspace-editor/CONTEXT.md)
- [Acceptance evidence](runs/ACCEPTANCE.md)
