---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: durable-product-history-2026-11-27
task_state: pr_open
task_revision: 75
repository_id: 1467144605
branch: feature/durable-product-history
base_branch: main
pr_number: 14
pr_url: https://github.com/paddybanerjee09/nutshell/pull/14
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

Private screenshot evidence merged and canonical cleanup was confirmed at idle revision 71. Draft PR #14 is open. The shared parser distinguishes unchanged accepted payloads from new declarations and rejects silent history rewrites or deletions. Twenty-nine parser and setup compatibility tests passed. PostgreSQL history and the affected collaboration and setup scenarios passed dedicated verification. Next exercise the integrated Windows alpha suite and the original history link in Firefox.

## Affected files

- [Product history context](features/product-history/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
