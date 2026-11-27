---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-repository-authoring-2026-11-27
task_state: pr_open
task_revision: 102
repository_id: 1467144605
branch: feature/local-repository-authoring
base_branch: main
pr_number: 19
pr_url: https://github.com/paddybanerjee09/nutshell/pull/19
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Local repository authoring

## Context

Complete repository initialization and semantic change authoring through the local CLI. Use shared schemas, keep owner bytes, and provide deterministic preview and noninteractive writes.

## Decision

The filesystem delegate owns bounded managed reads and targeted writes. The init delegate owns the setup command and shared local setup copy. The change delegate owns semantic record authoring. The lead owns integration, end-to-end CLI evidence, and source workflow.

## Consequences

The scratch CLI journey passed. The bounded full Windows run passed 261 tests, the optimized build, and its persisted worker. Firefox then missed a rendered evidence row even though the expected revision published and the exact image digest matched. Workspace controls now wait for layout restoration. The focused optimized run checks this with scripts paused briefly during the evidence reload.

## Affected files

- [Repository contract](architecture/GITHUB_CONTRACT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
