---
id: feature-tasks-notes
date: "2026-11-26"
status: planned
tags: [feature, tasks, notes, collaboration]
---

## Context

Planned feature only. No persisted tasks, note editor, or conflict handling is verified. This feature covers assignments, deadlines, and team notes within authorized repository workspaces.

## Decision

Follow [R-10 tasks and notes](../../../SPEC.md#13-r-10-tasks-and-team-notes). The specification owns editor and storage choices. Database collaboration records are distinct from CURRENT_TASK and from committed agent knowledge.

## Consequences

Do not imply that links synchronize records, assignments send notifications, or agents automatically receive database notes. Relevant gates: A18, A19. Record actual persistence and stale-save evidence when available.

## Affected files

- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- [Permissions context](../auth-permissions/CONTEXT.md) when relevant to the current task.
- Actual service, storage, and test files: not established.
