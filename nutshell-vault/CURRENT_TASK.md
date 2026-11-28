---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: source-check-lifecycle-2026-11-27
task_state: pr_open
task_revision: 159
repository_id: 1467144605
branch: codex/source-check-lifecycle
base_branch: main
pr_number: 31
pr_url: https://github.com/paddybanerjee09/nutshell/pull/31
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Source check lifecycle

## Context

Prevent premature and obsolete source validation runs from producing failure emails while retaining the exact-head merge gate.

## Decision

Skip the initial draft opening. Revalidate current GitHub identity before publishing a status and finish obsolete runs without posting one.

## Consequences

GitHub confirmed draft PR #31. The lead owns the workflow, validator, and integration. The delegate owns the source-check regression tests.

## Affected files

- [Source workflow](../.github/workflows/source-task.yml).
- [Source validator](../packages/cli/src/source-check.ts).
- [Source workflow guide](workflows/GIT_WORKFLOW.md).
