---
id: feature-tasks-notes
date: "2026-11-27"
status: active
tags: [feature, tasks, notes, collaboration]
---

## Context

Repository tasks and structured team notes persist in PostgreSQL. Tasks support a single assignee, calendar deadlines, blocker reasons, and entity links. Both records carry optimistic versions.

## Decision

Follow [R-10 tasks and notes](../../../SPEC.md#13-r-10-tasks-and-team-notes). The specification owns editor and storage choices. Database collaboration records are distinct from CURRENT_TASK and from committed agent knowledge.

Tasks use the stable repository identity and require the current installation, local membership, and repository grant on each operation. A reader may create and self-assign a task. The creator can edit or delete its details. Its assignee can change status and blocker, and a verified repository writer can manage other records or assign eligible members. Deadlines are stored as SQL dates. Conflicts return the current task and the submitted changes.

The Team tasks tab shows a filterable list and a detail editor. Conflict recovery keeps locally changed fields and adopts concurrent changes to untouched fields. A copied brief includes the authorized workspace URL and the indexed source revision.

The team-note schema supports separate Tiptap content with paragraphs, headings, lists, checklists, code blocks, and safe links. The server validates the versioned document against a strict schema and bounds its byte size, depth, and entry count. Current readers can create a note. Current creators and repository coordinators can edit or delete it. A stale write returns the attempted fields and the current saved version for reconciliation.

The Team notes tab exposes the structured editor through a compact keyboard-accessible block menu. It shows the current saved version after a conflict and lets the user keep their changed fields for a fresh save or load the saved note. Successful persistence drives the saved indicator.

## Consequences

Do not imply that links synchronize records, assignments send notifications, or agents automatically receive database notes. The [acceptance ledger](../../runs/ACCEPTANCE.md) records which collaboration paths have been verified.

## Affected files

- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- [Permissions context](../auth-permissions/CONTEXT.md) when relevant to the current task.
- [Workspace task panel](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-task-panel.tsx) and [browser verification](../../../scripts/local-browser.ts).
- [Task service](../../../packages/server/src/team-tasks.ts), [migration](../../../packages/server/migrations/0005_team_tasks.sql), and [PostgreSQL tests](../../../packages/server/src/team-tasks.test.ts).
- [Team note schema](../../../packages/core/src/team-note-content.ts), [service](../../../packages/server/src/team-notes.ts), and [migration](../../../packages/server/migrations/0006_team_notes.sql).
- [Workspace notes panel](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-team-note-panel.tsx) and [structured editor](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-team-note-editor.tsx).
