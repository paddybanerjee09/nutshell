---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-access-revocation-2026-11-27
task_state: pr_open
task_revision: 146
repository_id: 1467144605
branch: feature/live-access-revocation
base_branch: main
pr_number: 28
pr_url: https://github.com/paddybanerjee09/nutshell/pull/28
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Signed live access revocation

## Context

Use signed GitHub events to invalidate exact local installation, repository, and user access scopes without losing private data.

## Decision

Record negative lifecycle deliveries and revoke affected associations atomically. Bump repository epochs so queued jobs cannot publish and never restore access from a replayed event.

## Consequences

GitHub confirmed draft PR #28. The lead owns atomic revocation and PostgreSQL proof. The delegate owns the signed lifecycle route and controlled payload tests.

## Affected files

- [Authorization context](features/auth-permissions/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
