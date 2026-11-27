---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-authoring-compatibility-2026-11-27
task_state: ready_for_review
task_revision: 110
repository_id: 1467144605
branch: feature/local-authoring-compatibility
base_branch: main
pr_number: 20
pr_url: https://github.com/paddybanerjee09/nutshell/pull/20
last_verified_head: 103b25186aa9178e656b4cfacecf6f8805d5e4b8
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Local authoring compatibility

## Context

Make local repository initialization work with a valid preexisting vault and keep semantic change authoring usable after accepted narrative paths are archived.

## Decision

Keep separately owned setup-builder and semantic-history changes. Preserve owner files and use immutable Git evidence to distinguish retained changes from unpublished working-tree edits.

## Consequences

The integrated head passed lint, strict types, 264 tests, the optimized build, and a persisted worker job. The full browser run timed out opening the Product Map edge. Both graph modes passed on the same optimized build and indexed fixture in a focused run. The setup and change CLI paths passed. Confirm the latest trusted source check, then merge and clear only the matching task.

## Affected files

- [Repository contract](architecture/GITHUB_CONTRACT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
