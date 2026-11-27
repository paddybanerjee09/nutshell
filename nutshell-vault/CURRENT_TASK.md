---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-authoring-compatibility-2026-11-27
task_state: pr_open
task_revision: 107
repository_id: 1467144605
branch: feature/local-authoring-compatibility
base_branch: main
pr_number: 20
pr_url: https://github.com/paddybanerjee09/nutshell/pull/20
last_verified_head: null
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

Both failures reproduced without writes. GitHub created draft PR #20 from the confirmed canonical idle revision 105. Verify each edge with the affected suites, then run Windows alpha verification on the integrated head.

## Affected files

- [Repository contract](architecture/GITHUB_CONTRACT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
