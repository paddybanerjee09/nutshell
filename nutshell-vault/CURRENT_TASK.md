---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: vault-context-2026-11-27
task_state: pr_open
task_revision: 32
repository_id: 1467144605
branch: feature/vault-context
base_branch: main
pr_number: 7
pr_url: https://github.com/paddybanerjee09/nutshell/pull/7
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

Draft PR #7 opened from canonical idle revision 30. Core owns index routing, budgets, and section selection. The CLI owns bounded revision sources and readable and JSON output. Exercise both revision modes and archive isolation before promotion.

## Affected files

- [Memory context](features/memory-vault/CONTEXT.md)
- [Memory protocol](workflows/MEMORY_PROTOCOL.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
