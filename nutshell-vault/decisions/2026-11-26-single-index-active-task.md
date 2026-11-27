---
id: decision-single-index-active-task
date: "2026-11-26"
status: accepted
tags: [decision, workflow, memory, retrieval]
decision_key: workflow.memory.single-task
---

## Context

The user replaced the earlier multi-index/checkpoint approach with one lightweight _INDEX, one always-read CURRENT_TASK, relevant finalized decisions, and an archive excluded by default. This is a finalized workflow choice, not an application feature completion.

## Decision

Use one repository-wide active feature task. The lead alone overwrites CURRENT_TASK; delegates work within that feature. _INDEX inventories active Markdown with short descriptions and tags. Finalized decisions use short dated notes and stable decision_key values; other tentative material stays in feature context or CURRENT_TASK.

Normalize active durable notes to Context, Decision, Consequences, and Affected files, targeting fewer than 200 lines. Supersede older guidance explicitly and update the index. Clear the active task after observed feature-PR merge and the defined cleanup.

## Consequences

After normal root AGENTS instructions, agents read _INDEX first, then CURRENT_TASK, before loading only relevant notes. There are no additional active feature/template indexes, run-current files, or default history logs. Archived material retains provenance but does not compete in ordinary retrieval. The new workflow does not imply that a PR, build, or test has occurred.

## Affected files

- [AGENTS.md](../../AGENTS.md), then [_INDEX.md](../_INDEX.md), then [CURRENT_TASK.md](../CURRENT_TASK.md).
- [MEMORY_PROTOCOL.md](../workflows/MEMORY_PROTOCOL.md) and [GIT_WORKFLOW.md](../workflows/GIT_WORKFLOW.md).
- [NOTE.md](../templates/NOTE.md) and [TASK.md](../templates/TASK.md).
- [Former protocol](../archive/2026-11-26-workflow-migration/workflows/MEMORY_PROTOCOL.md), for explicit historical inspection only.
