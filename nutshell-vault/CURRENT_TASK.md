---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: final-alpha-evidence-2026-11-27
task_state: ready_for_review
task_revision: 163
repository_id: 1467144605
branch: codex/final-alpha-evidence
base_branch: main
pr_number: 32
pr_url: https://github.com/paddybanerjee09/nutshell/pull/32
last_verified_head: b1339396486c8459dae8c3c62525a81507743387
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Final alpha browser evidence

## Context

Record the final native browser and startup evidence for the verified local alpha.

## Decision

Record Chrome native zoom and editor composition separately from OS keyboard input. Use the real documentation PR to observe the corrected draft-opening source check.

## Consequences

The final app, worker and database were confirmed locally. Both browser checks and the vault validator passed. GitHub skipped the job at draft opening without posting a candidate status. Verify the bound head before merging and confirm guarded cleanup.

## Affected files

- [UI acceptance](design/UI_ACCEPTANCE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
