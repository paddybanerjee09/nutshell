---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: fixture-sync-2026-11-26
task_state: in_progress
task_revision: 17
repository_id: 1467144605
branch: feature/fixture-sync
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

Build the first fixture-provider ingestion slice. A signed default-branch delivery should produce a durable, validated repository snapshot that authorized sessions can read.

## Decision

Use immutable fixture trees and PostgreSQL receipts. Validate repository records in core, keep canonical publication and authorization in server, and let the existing worker process queued receipts. Distinct fixture repositories and revision checks keep invalid or superseded work from replacing the current snapshot.

## Consequences

PR #3 passed Windows verification and merged. GitHub confirmed its guarded cleanup at canonical idle revision 16. This task starts from that commit. Open the new source draft and exercise the real local ingress and worker before promotion.

## Affected files

- [Synchronization context](features/github-sync/CONTEXT.md)
- [GitHub and record contract](architecture/GITHUB_CONTRACT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
