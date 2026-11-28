---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-alpha-handoff-2026-11-27
task_state: pr_open
task_revision: 154
repository_id: 1467144605
branch: feature/local-alpha-handoff
base_branch: main
pr_number: 30
pr_url: https://github.com/paddybanerjee09/nutshell/pull/30
last_verified_head: null
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

GitHub confirmed draft PR #30. The lead owns the verification option, local lifecycle and handoff. The delegate is checking native browser zoom and text composition.

## Affected files

- [Local setup](workflows/LOCAL_SETUP.md).
- [UI acceptance](design/UI_ACCEPTANCE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
