---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: live-pull-request-checks-2026-11-27
task_state: ready_for_review
task_revision: 151
repository_id: 1467144605
branch: feature/live-pull-request-checks
base_branch: main
pr_number: 29
pr_url: https://github.com/paddybanerjee09/nutshell/pull/29
last_verified_head: 4889d519758640b7b92f50bae8ef45d0779398b4
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

The 106 scoped cases, strict checks, optimized Webpack build, and local fixture worker restart passed. A standalone live-mode worker started and shut down with disposable PostgreSQL and product network disabled. Both configured local databases migrated. Confirm the exact trusted source check, merge PR #29, and apply guarded cleanup.

## Affected files

- [GitHub synchronization](features/github-sync/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
