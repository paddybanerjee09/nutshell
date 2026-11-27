---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: github-app-adapter-2026-11-27
task_state: ready_for_review
task_revision: 86
repository_id: 1467144605
branch: feature/github-app-adapter
base_branch: main
pr_number: 16
pr_url: https://github.com/paddybanerjee09/nutshell/pull/16
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# GitHub App adapter

## Context

Implement and verify the GitHub App API boundary against controlled provider responses, including token rotation, repository authority, immutable reads, setup proposals, and exact-head Checks.

## Decision

The transport delegate owns bounded GitHub requests and installation credentials. The repository delegate owns current access, immutable source reads, and Check targeting. The authorization delegate owns GitHub App configuration, App user token refresh, and encrypted storage integration. The lead owns setup proposal targeting, integration, verification, and source workflow.

## Consequences

Controlled GitHub App and setup-tree suites passed 41 tests. Configured provider responses exercised credentials, immutable repository reads, and exact PR targeting. No live product credentials or disposable repository were supplied. Next verify the source check and merge the exact PR, then confirm canonical cleanup.

## Affected files

- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Repository authority contract](architecture/GITHUB_CONTRACT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
