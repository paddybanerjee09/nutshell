---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: fixture-sync-2026-11-26
task_state: ready_for_review
task_revision: 20
repository_id: 1467144605
branch: feature/fixture-sync
base_branch: main
pr_number: 4
pr_url: https://github.com/paddybanerjee09/nutshell/pull/4
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

GitHub confirmed draft PR #4 against canonical idle revision 16. Windows `pnpm alpha:setup` and `pnpm alpha:verify` passed, including 70 tests, the optimized application, two isolated signed fixture snapshots, invalid-head preservation, and browser shutdown. Require the trusted check on the final PR head and record that head in the PR. Clear this task only after GitHub confirms the matching merge.

## Affected files

- [Synchronization context](features/github-sync/CONTEXT.md)
- [GitHub and record contract](architecture/GITHUB_CONTRACT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
