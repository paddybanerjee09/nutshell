---
id: workflow-git
date: 2026-11-26
status: active
tags: [workflow, git, pull-requests, task-lifecycle]
---
# Git workflow

## Context

Feature work requires a real development pull request. This document governs Nutshell's own source work; a simulated customer-repository PR in the demo cannot satisfy that requirement. Apply this workflow when implementation is authorized. Opening the starter alone does not authorize a build, remote mutation, merge, or repository-policy change.

Read [the exhaustive active-file index](../_INDEX.md), then [CURRENT_TASK.md](../CURRENT_TASK.md), then only the active notes needed for the task. The index includes all active managed Markdown and root AGENTS/SPEC/README control references, never archived entries. Historical discovery uses an explicit archive search. There is one current-task file and one lead writer. Subagents send progress to the lead instead of creating competing task files, run summaries or private authoritative checklists.

## Decision

### Start or resume one feature task

Inspect branch, remote identity, worktree, existing instructions and unrelated changes. Resume a matching active task; do not overwrite it with a new feature while its PR or cleanup is unresolved. The lead overwrites CURRENT_TASK with the current plan, actual progress, verification, blockers and next action. Record stable task/repository identity, branch/base and the feature PR when known. Never turn it into an append-only diary.

Every overwrite compares the expected `task_id` and `task_revision` and advances the revision; a stale writer must reread instead of discarding newer state. The note's frontmatter `status` remains separate from its `task_state`. Before the first feature, establish the real development remote, authentication and authorized branch-push/PR operations. Missing prerequisites block starting features; independent environment/setup/documentation work may proceed. The product's live GitHub App credentials are a different integration and are unnecessary for the local demo.

Use a feature branch/worktree and small coherent commits. With the verified setup, push that branch and open a real PR early; use a draft PR when supported. If remote access or PR creation fails mid-feature, retain that task/branch and record `PR gate blocked`. Independent work on the same task may continue, but it is not integrated or complete, and no next feature begins before the real PR and cleanup finish. Do not invent a PR URL or replace this gate with a simulated merge.

One lead integrates delegated branches into the feature branch. Delegates use explicit file ownership or worktrees and do not race schema, lockfile or task-file edits. Merging a delegate branch locally is not permission to bypass the feature PR into the default branch.

### Commit and maintain relevant memory

Complete the smallest useful slice, verify the behavior actually affected, update relevant memory and commit. Repeat within a feature; do not accumulate an entire application into one commit or split a cohesive migration and consumer into broken checkpoints. For documentation, inspect content and links; do not invent application tests.

Stage explicit paths/hunks and inspect the staged diff. Exclude unrelated work, secrets and generated data. Preserve hooks and checks; do not use `--no-verify`, force pushes or destructive resets to conceal a blocker. Report failed, blocked and unrun checks accurately.

Finalized decisions live in `nutshell-vault/decisions/YYYY-MM-DD-topic.md`, with subsystem tags, a stable `decision_key` and at most one accepted active note per key. Load only decisions relevant to the current subsystem. Use the four required sections, remove superseded guidance from active notes, and update `_INDEX.md` and repository-relative supersession links in the same slice. Remove archived notes from the active index; archive material requires explicit historical search. Do not recreate per-feature running histories or redundant indexes. Keep transient progress only in CURRENT_TASK; commit history, PR metadata and relevant decision notes retain durable evidence.

### Validate and merge the feature PR

Keep CURRENT_TASK active through review and merge. Do not put the idle/cleared file in the final feature commit in anticipation of a future merge. Record the final tested PR head in PR metadata or check evidence after the final commit; a tracked task file cannot contain its own final commit SHA.

Verify the actual PR, target repository/base, latest head, required checks and review conditions. Merge only when the operation is already authorized and GitHub permits it. Pass the expected PR head when the supported merge API offers that guard. An accepted merge request, queued operation, local merge or `closed` state does not prove a remote merge. Re-read the exact PR and its merged status before cleanup. [GitHub merge status and head guards](https://docs.github.com/en/rest/pulls/pulls)

If the PR is closed without merging, retain the task as blocked/closed-unmerged. Reopen it or create an explicitly authorized replacement PR for the same task, then update the exact PR association. A later event for the superseded PR must not clear the current task. New commits after review require fresh relevant checks; do not reuse stale evidence.

### Clear only after the matching merge

1. Confirm the exact repository, task marker, PR number/base and provider-observed merged head against recorded PR/check evidence. Do not trust a webhook alone or equate a test-merge SHA with a completed merge.
2. Refresh the default branch in a clean checkout without discarding user work. Read its CURRENT_TASK and compare its task ID, repository and feature PR with the completed task. Also capture its current blob/base revision. A newer or different task means **no cleanup write**.
3. Only after that confirmation, the lead may overwrite CURRENT_TASK locally with the standard idle template. The feature PR itself merged an active brief; canonical default-branch state stays active until the separate cleanup write lands.
4. Persist the one-file cleanup through an already authorized housekeeping writer only if existing branch policy permits that write. Otherwise open a tiny cleanup-only PR from the refreshed default branch. Mark it as cleanup for the exact completed task/feature PR in durable PR metadata. It is exempt from creating a new feature task and from spawning another cleanup PR.
5. Before merging that cleanup PR, re-read the default-branch task/blob and recompare identity/base. If they changed, stop, close or refresh the stale cleanup after inspection; never apply its old idle file over newer work. Enforce the expected blob/base at the actual write or protected merge boundary; a client-side reread alone is insufficient. If the available path cannot reject stale state, report cleanup blocked. Respect required checks and merge authorization. Confirm the cleanup actually merged before claiming canonical idle.

Pending cleanup blocks starting the next feature. The local idle file is not evidence that canonical cleanup finished; track its pending PR/status in durable PR metadata and check current remote state on resume. If cleanup cannot be authorized, preserve the checkpoint and report the blocked gate. A repeated completion event is idempotent. Cleanup-only PRs do not create a recursive task/cleanup cycle.

For this source repository, the owner authorized a one-file housekeeping commit while current branch policy permits it. With a verified matching merge and task blob, use GitHub's [createCommitOnBranch mutation](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch) with the verified canonical commit as `expectedHeadOid`. GitHub rejects a moved head. Refresh the default branch and verify the cleanup commit's parent, changed paths, and task revision before starting the next feature. [PR #1](https://github.com/paddybanerjee09/nutshell/pull/1) records the first observed cleanup.

### Enforcement without false claims

Agent instructions establish the workflow; local validators can check task identity, metadata, changed paths and memory shape. GitHub-enforced PR/check requirements exist only when the repository's actual protection/ruleset is configured and applicable. A Markdown instruction or passing local command does not configure remote enforcement.

The source workflow associates the task with the current GitHub PR and publishes `nutshell/source-task` on the candidate head. It installs pinned dependencies from the trusted base and validates candidate Git objects as data. The [pull_request_target guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target) governs the boundary.

The initial draft opening skips the job while GitHub assigns the PR number. The binding push triggers validation. If the current GitHub PR is already closed or its exact comparison or description superseded the event, the runner ends without publishing a commit status. Verify a passing PR-bound status on the final current head before merging.

Where supported, the repository owner can require PRs and trusted checks on the default branch. GitHub permits requiring a PR without necessarily requiring human approval; preserve any existing review requirements. Availability depends on plan and configuration. Do not weaken policy or add a bypass merely to make cleanup succeed. [GitHub ruleset requirements](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

## Consequences

Feature integration and task clearing are two observable operations. Cleanup can be temporarily pending under branch protection; the agent must report that state rather than claiming instantaneous canonical clearing. A preauthorized housekeeping mechanism can remove that delay, but this starter neither installs one nor grants its privileges.

The demo remains useful while Nutshell is built: simulated fixture merges test the product ingestion path, while real development PRs provide the source-work gate. Missing development remote/authentication can block that gate even when local product tests pass. Continue independent work on the same task, retain exact evidence, and never translate a simulated result into a real merge.

## Affected files

- `AGENTS.md` and `SPEC.md`: source-work authorization, feature PR and finishing rules.
- `nutshell-vault/_INDEX.md`: single exhaustive registry of active managed Markdown and root control references; no archived entries.
- `nutshell-vault/CURRENT_TASK.md`: sole overwrite-in-place task state, cleared after verified matching merge through the cleanup protocol.
- Relevant subsystem notes and top-level `nutshell-vault/decisions/YYYY-MM-DD-topic.md`; feature code/tests and its real PR.
- Existing repository protection, checks and authorized housekeeping automation, if configured; no policy changes are implied.
