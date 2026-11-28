---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-alpha-handoff-2026-11-27
task_state: ready_for_review
task_revision: 156
repository_id: 1467144605
branch: feature/local-alpha-handoff
base_branch: main
pr_number: 30
pr_url: https://github.com/paddybanerjee09/nutshell/pull/30
last_verified_head: fb6925423b35257c1e3a919b0acae0aba13c1b2d
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Local alpha verification and handoff

## Context

Make full Windows verification reproducible and document observed startup, operating steps and remaining acceptance evidence.

## Decision

Keep the default verification and add an explicit Webpack build option that runs the same checks. Verify the final local runtime with real PostgreSQL, the fixture provider and bounded browser journeys.

## Consequences

Full Windows verification with Webpack passed with 385 tests across 57 suites. The native browser and live-provider acceptance limits are recorded in the ledger. Confirm the trusted source check on the final GitHub head and guard canonical cleanup after merge.

## Affected files

- [Local setup](workflows/LOCAL_SETUP.md).
- [UI acceptance](design/UI_ACCEPTANCE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
