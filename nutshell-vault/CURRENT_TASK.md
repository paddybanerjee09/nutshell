---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-pull-request-checks-2026-11-27
task_state: in_progress
task_revision: 149
repository_id: 1467144605
branch: feature/live-pull-request-checks
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Durable live pull request checks

## Context

Use a signed GitHub pull request event to schedule independent validation of its exact head and trusted base.

## Decision

Accept the exact PR comparison in a durable receipt. Share scoped installation reads and epoch checks. Revalidate and publish an idempotent app-owned Check for the observed immutable head and base.

## Consequences

Guarded idle revision 148 is confirmed. Verify controlled provider behavior and real local PostgreSQL. Observe the draft PR before binding its identity.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
