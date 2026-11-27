---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: fixture-onboarding-2026-11-26
task_state: ready_for_review
task_revision: 24
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

Windows `pnpm alpha:setup` and `pnpm alpha:verify` passed. The verifier ran 84 tests, built the optimized app, exercised the real PostgreSQL worker and Firefox onboarding journey, and completed the signed fixture checks and shutdown. Verify the final source head on PR #5 and clear the task after GitHub confirms the exact merge.

## Affected files

- [Synchronization context](features/github-sync/CONTEXT.md)
- [GitHub and record contract](architecture/GITHUB_CONTRACT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
