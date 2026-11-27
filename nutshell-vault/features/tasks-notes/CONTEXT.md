---
id: feature-tasks-notes
date: "2026-11-27"
status: active
tags: [feature, tasks, notes, collaboration]
---

## Context

Repository tasks persist in PostgreSQL with a single assignee, calendar deadlines, blocker reasons, entity links, and optimistic versions. Structured team notes remain planned.

## Decision

Follow [R-10 tasks and notes](../../../SPEC.md#13-r-10-tasks-and-team-notes). The specification owns editor and storage choices. Database collaboration records are distinct from CURRENT_TASK and from committed agent knowledge.

Tasks use the stable repository identity and require the current installation, local membership, and repository grant on each operation. A reader may create and self-assign a task. The creator can edit or delete its details. Its assignee can change status and blocker, and a verified repository writer can manage other records or assign eligible members. Deadlines are stored as SQL dates. Conflicts return the current task and the submitted changes.

## Consequences

Do not imply that links synchronize records, assignments send notifications, or agents automatically receive database notes. Relevant gates: A18, A19. Record actual persistence and stale-save evidence when available.

## Affected files

- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- [Permissions context](../auth-permissions/CONTEXT.md) when relevant to the current task.
- [Task service](../../../packages/server/src/team-tasks.ts), [migration](../../../packages/server/migrations/0005_team_tasks.sql), and [PostgreSQL tests](../../../packages/server/src/team-tasks.test.ts).
