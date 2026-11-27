---
id: control-current-task
date: "2026-11-26"
status: active
tags: [control, task, pull-requests]
task_id: source-task-check-2026-11-26
task_state: in_progress
task_revision: 5
repository_id: 1467144605
branch: feature/source-task-check
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

Implement the source task lifecycle check. It validates the lead-owned task on feature PRs against the canonical revision and provider identity, and defines the guards for housekeeping after a verified merge.

## Decision

Use the shared validator and immutable Git inputs. Run the source check from the trusted default branch and publish the result on the exact feature head. Keep the repository's current protections in place.

## Consequences

PR #1 merged and GitHub's expected-head cleanup advanced the canonical task to idle revision 4. Open this feature's draft PR with the lifecycle baseline, then integrate and verify the lifecycle and CI checks.

## Affected files

- [Task template](templates/TASK.md) and [Git workflow](workflows/GIT_WORKFLOW.md)
- [Memory vault context](features/memory-vault/CONTEXT.md)
- `packages/core/`, `packages/cli/`, and `.github/workflows/`
