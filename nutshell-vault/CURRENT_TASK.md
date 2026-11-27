---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-verification-recovery-2026-11-27
task_state: ready_for_review
task_revision: 115
repository_id: 1467144605
branch: feature/local-verification-recovery
base_branch: main
pr_number: 21
pr_url: https://github.com/paddybanerjee09/nutshell/pull/21
last_verified_head: 0443908bcdcc1fd0142332bb73c8309321fe972e
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Local verification recovery

## Context

Implement an explicit verification reset command and demonstrate worker recovery of a signed receipt accepted while the worker is stopped.

## Decision

Target the exact loopback verification database. Restrict reset to identified synthetic fixture state and coordinate it with verification. Exercise durable recovery through the running web route and restarted worker.

## Consequences

The exact packaged reset preserved the interactive database, unrelated test row, and screenshot assets. The full Windows verification exited zero with 274 tests, the optimized build, worker restart and exact signed publication, the complete Firefox journey, and shutdown. Confirm the latest trusted source check, then merge and clear only this matching task.

## Affected files

- [Local setup](workflows/LOCAL_SETUP.md).
- [Fixture receipt outbox](decisions/2026-11-26-fixture-receipt-outbox.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
