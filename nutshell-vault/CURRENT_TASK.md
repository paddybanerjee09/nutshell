---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-verification-recovery-2026-11-27
task_state: in_progress
task_revision: 112
repository_id: 1467144605
branch: feature/local-verification-recovery
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
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

Canonical idle revision 111 is confirmed after PR #20. The database delegate owns scoped reset and tests. The lead owns command and process integration, worker recovery verification, and source workflow.

## Affected files

- [Local setup](workflows/LOCAL_SETUP.md).
- [Fixture receipt outbox](decisions/2026-11-26-fixture-receipt-outbox.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
