---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: vault-context-2026-11-27
task_state: in_progress
task_revision: 31
repository_id: 1467144605
branch: feature/vault-context
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

Implement revision-aware `nutshell context` with mandatory controls, ranked excerpts, a bounded budget, and explicit historical retrieval.

## Decision

Reuse the shared index parser and bounded source readers. Default to the exact checked-out Git revision and offer explicit ref or working-tree selection. Read optional bodies only after ranking metadata.

## Consequences

GitHub confirmed PR #6 merged and canonical cleanup reached idle revision 30. Open the next source draft and verify selection, budget, revision isolation, path safety, and archive boundaries.

## Affected files

- [Memory context](features/memory-vault/CONTEXT.md)
- [Memory protocol](workflows/MEMORY_PROTOCOL.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
