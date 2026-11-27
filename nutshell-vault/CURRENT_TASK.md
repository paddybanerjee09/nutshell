---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: null
task_state: idle
task_revision: 16
repository_id: null
branch: null
base_branch: null
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: null
integration_checkout: null
cleanup_pr_url: null
---
# Current task

## Context

No feature is currently active. Every agent reads [_INDEX.md](_INDEX.md) first, then this file, before selecting relevant context.

## Decision

The lead starts the next feature only after verifying the canonical idle task and confirming the source preflight remains valid.

## Consequences

See [ACCEPTANCE.md](runs/ACCEPTANCE.md) for observed verification and [GIT_WORKFLOW.md](workflows/GIT_WORKFLOW.md) for the feature and cleanup procedure.

## Affected files

- [Task template](templates/TASK.md)
- [Vault index](_INDEX.md)
