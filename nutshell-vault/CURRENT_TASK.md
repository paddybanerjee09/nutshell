---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: vault-validation-2026-11-26
task_state: in_progress
task_revision: 1
repository_id: 1467144605
branch: feature/vault-validation
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
lead_agent: codex-lead
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Establish the source baseline and implement the first R-06 slice for validating the active vault catalog and durable note metadata. The source repository is [paddybanerjee09/nutshell](https://github.com/paddybanerjee09/nutshell).

## Decision

Preserve the supplied starter, attach it to the existing source history through the feature PR, and add a bounded shared validator, checkout command, and focused tests within this PR. The lead owns the toolchain, integration, and task state. Delegates own discrete validator and CLI files.

## Consequences

Source preflight verified the repository, write-capable credentials, and the absence of configured main-branch protections and required checks. The owner authorized verified feature merges and expected-head cleanup. Local PostgreSQL preflight is in progress. Publish the first starter-baseline commit and open the draft PR before integrating validator work.

## Affected files

- [Memory vault context](features/memory-vault/CONTEXT.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
- `packages/core/` and `packages/cli/` for the validator and its command
