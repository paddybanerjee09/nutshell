---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: durable-product-history-2026-11-27
task_state: ready_for_review
task_revision: 76
repository_id: 1467144605
branch: feature/durable-product-history
base_branch: main
pr_number: 14
pr_url: https://github.com/paddybanerjee09/nutshell/pull/14
last_verified_head: 40b3a8ec2a9d1542b9a1119ee51b5389fd4ea629
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Durable product history

## Context

Preserve accepted semantic change records with their first indexed revisions, original memory and entity references, corrections and reversals, and truthful evidence in the workspace.

## Decision

The store delegate owns database history, publication, and authorized reads. The parser delegate owns shared history validation and focused tests. The UI delegate owns the workspace history tab and source references. The lead owns fixtures and browser verification, memory, commits, and source integration.

## Consequences

Migration 0008 passed in both local databases. Windows pnpm alpha:verify passed 167 tests, the optimized build, persisted worker, Firefox and signed fixture journeys, and scoped shutdown. Firefox reopened the original note after an archive move, followed corrections and reversals, and kept the last valid source after two invalid-history receipts. Next verify the exact GitHub head and apply guarded cleanup after merge.

## Affected files

- [Product history context](features/product-history/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
