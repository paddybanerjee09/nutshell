---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: local-repository-authoring-2026-11-27
task_state: in_progress
task_revision: 97
repository_id: 1467144605
branch: feature/local-repository-authoring
base_branch: main
pr_number: null
pr_url: null
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

GitHub confirmed PR #18 merged and its guarded canonical cleanup advanced to idle revision 96. Work in isolated scratch repositories for authoring tests. Verify the actual CLI without mutating this checkout's development task.

## Affected files

- [Repository contract](architecture/GITHUB_CONTRACT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
