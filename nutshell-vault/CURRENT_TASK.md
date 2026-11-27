---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: durable-product-history-2026-11-27
task_state: in_progress
task_revision: 72
repository_id: 1467144605
branch: feature/durable-product-history
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
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

Private screenshot evidence merged and canonical cleanup was confirmed at idle revision 71. Next open the draft source PR and integrate history validation, storage, and the workspace.

## Affected files

- [Product history context](features/product-history/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
