---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: fixture-onboarding-2026-11-26
task_state: pr_open
task_revision: 23
repository_id: 1467144605
branch: feature/fixture-onboarding
base_branch: main
pr_number: 5
pr_url: https://github.com/paddybanerjee09/nutshell/pull/5
last_verified_head: null
lead_agent: codex-lead
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Give an authorized fixture repository administrator one durable setup proposal and an explicit simulated merge so the normal local workspace can initialize a repository snapshot.

## Decision

Preserve owner-managed files and instructions. Pin the setup proposal and check to the underlying fixture revision. Reuse repository authorization and send the simulated merge through the signed local webhook and worker.

## Consequences

Draft PR #5 opened from canonical idle revision 21. Core owns setup tree construction, server owns durable proposal state and configuration authority, and web owns the repository setup actions. Verify repeat setup, a real browser journey, and signed publication before promotion.

## Affected files

- [Synchronization context](features/github-sync/CONTEXT.md)
- [GitHub and record contract](architecture/GITHUB_CONTRACT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
