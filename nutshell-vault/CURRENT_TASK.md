---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: github-app-adapter-2026-11-27
task_state: in_progress
task_revision: 83
repository_id: 1467144605
branch: feature/github-app-adapter
base_branch: main
pr_number: null
pr_url: null
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

The interactive preview merged and canonical cleanup was confirmed at idle revision 82. Next open the draft source PR and integrate the controlled adapter contracts.

## Affected files

- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Repository authority contract](architecture/GITHUB_CONTRACT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
