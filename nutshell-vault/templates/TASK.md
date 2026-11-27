---
id: template-current-task
date: "2026-11-26"
status: active
tags: [template, task, control]
---

## Context

Use this shape for the sole CURRENT_TASK control file, written only by the lead. This template is guidance, not a second task. [SPEC 9.2](../../SPEC.md#92-one-current-task-one-writer) owns the schema and [GIT_WORKFLOW.md](../workflows/GIT_WORKFLOW.md) owns merge/cleanup recovery. Unknown identities remain null until observed.

The actual CURRENT_TASK frontmatter contains all these fields:

| Field | Rule |
| --- | --- |
| id | Stable identity of the control file; retain across tasks and cleanup |
| date | Actual note update date |
| status | Always active, including while task_state is idle |
| tags | Meaningful control/task tags retained in the active index |
| task_id | Unique ID for the feature task; null when idle |
| task_state | idle, in_progress, pr_open, ready_for_review, blocked, or cleanup_pending |
| task_revision | Monotonic integer across cleanup and new tasks; advance on every accepted overwrite and never restart at zero |
| repository_id | Actual source-development repository identity, or null |
| branch | Actual feature branch, or null |
| base_branch | Actual target branch, or null |
| pr_number | Observed source feature PR number, or null |
| pr_url | Observed source feature PR URL, or null |
| lead_agent | Current task's lead identity, or null |
| integration_checkout | Actual authoritative integration checkout, or null |
| last_verified_head | An actually verified known revision, or null; never the final SHA of the containing commit |
| cleanup_pr_url | Observed cleanup-only PR URL when applicable, or null |

In this section of the task body, state one feature's objective, scope, and boundaries. Do not invent branches, PRs, reviews, or verification.

## Decision

Overwrite the concise plan as it changes. Record delegated ownership within the same feature. Before each mutation, the lead rereads the authoritative file, compares the expected task_id and task_revision, and increments the revision. A stale writer rereads instead of overwriting newer state. Worktree copies are views of this one logical task.

Do not append a transcript, start a second active feature, or create another task ledger. Keep the task active throughout its real feature PR. Passing tests, a local merge, a fixture merge, a closed-unmerged PR, or an expected future merge never authorize an idle reset.

Prepare cleanup only after confirming the exact matching repository/feature PR/task merged, refreshing the default branch, and checking its task identity, task revision, and blob/base revision. Preserve durable decisions and evidence first. Persist cleanup through the already permitted writer or guarded cleanup-only PR described in GIT_WORKFLOW. Recheck the base and task before accepting cleanup; stale cleanup must not erase newer work.

The verified idle cleanup retains id, status active, and control tags; updates date; advances the existing task_revision; sets task_state to idle; and clears task_id, repository_id, branch, base_branch, pr_number, pr_url, lead_agent, integration_checkout, last_verified_head, and cleanup_pr_url to null. Clear these task-specific associations only through that verified cleanup. A later new task receives a fresh task_id without resetting task_revision.

Replace completed-task working text with a neutral four-section idle brief whose Context says no feature is currently active. Preserve implementation facts and evidence in relevant feature context and ACCEPTANCE. Never copy an initial starter statement such as implementation not started into a later idle reset after features have been completed.

A locally prepared idle file is only a proposed cleanup. Report cleanup_pending until the matching cleanup is confirmed on the canonical branch; only then claim canonical idle or begin another feature. Cleanup-only PRs do not create a new feature task or recursive cleanup. Keep final tested-head evidence in PR/check metadata.

## Consequences

Record actual progress, verification, unresolved blockers, relevant user changes, and the next executable step here. Separate local, simulated, and live evidence. After normal root AGENTS instructions, every agent reads _INDEX first, then CURRENT_TASK, before selecting relevant notes. Every delegate receives the authoritative integration checkout and task revision; it reports to the lead instead of committing a competing control file.

Initial idle state means no feature has started, not that the application is complete. A reset of a previously active task is valid only through confirmed matching merge and canonical cleanup. If that cleanup is blocked, preserve the evidence and do not start a new feature.

## Affected files

List actual scoped source/test/note files and links to relevant finalized decisions. Preserve unrelated work. The lead coordinates shared control/index updates. On reset, remove the completed task's working file list; retained decisions, PR/check metadata, and acceptance evidence hold its durable results.
