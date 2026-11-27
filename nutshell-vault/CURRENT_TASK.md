---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: fixture-onboarding-2026-11-26
task_state: in_progress
task_revision: 22
repository_id: 1467144605
branch: feature/fixture-onboarding
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

Give an authorized fixture repository administrator one durable setup proposal and an explicit simulated merge so the normal local workspace can initialize a repository snapshot.

## Decision

Preserve owner-managed files and instructions. Pin the setup proposal and check to the underlying fixture revision. Reuse repository authorization and send the simulated merge through the signed local webhook and worker.

## Consequences

PR #4 merged and canonical cleanup confirmed idle revision 21. Open the setup feature draft and verify authorization, repeat onboarding, and the actual fixture ingestion path.

## Affected files

- [Synchronization context](features/github-sync/CONTEXT.md)
- [GitHub and record contract](architecture/GITHUB_CONTRACT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
