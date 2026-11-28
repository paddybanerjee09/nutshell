---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: source-check-lifecycle-2026-11-27
task_state: in_progress
task_revision: 158
repository_id: 1467144605
branch: codex/source-check-lifecycle
base_branch: main
pr_number: null
pr_url: null
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

Canonical cleanup for PR #30 is confirmed at revision 157. Open a draft for this feature, record its assigned identity, and verify the focused lifecycle cases before merging.

## Affected files

- [Source workflow](../.github/workflows/source-task.yml).
- [Source validator](../packages/cli/src/source-check.ts).
- [Source workflow guide](workflows/GIT_WORKFLOW.md).
