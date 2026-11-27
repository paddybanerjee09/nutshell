---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: vault-validation-2026-11-26
task_state: ready_for_review
task_revision: 3
repository_id: 1467144605
branch: feature/vault-validation
base_branch: main
pr_number: 1
pr_url: https://github.com/paddybanerjee09/nutshell/pull/1
last_verified_head: null
lead_agent: codex-lead
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Current task

## Context

Establish the source baseline and implement the first R-06 slice for validating the active vault catalog and durable note metadata. The source repository is [paddybanerjee09/nutshell](https://github.com/paddybanerjee09/nutshell).

## Decision

The first commit preserves the supplied starter. The validator and CLI check managed vault snapshots with bounded inputs. The lead integrated the two delegated modules and owns PR verification and cleanup.

## Consequences

Lint, typecheck, and focused tests passed locally. Verify both CLI modes and the focused checks on the exact final PR head, then confirm the remote merge before preparing the matching expected-head cleanup.

## Affected files

- [Memory vault context](features/memory-vault/CONTEXT.md)
- [Local setup](workflows/LOCAL_SETUP.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
- `packages/core/` and `packages/cli/` for the validator and its command
