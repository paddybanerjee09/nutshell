---
id: decision-workspace-layout-preferences
date: "2026-11-27"
status: accepted
tags: [decision, workspace, panes, preferences]
decision_key: ui.workspace-layout-preferences
---

## Context

The workspace opens documents and records from one authorized indexed snapshot. Pane arrangements need to survive reload and narrow viewports without duplicating document state.

## Decision

Persist the versioned split tree, pane tabs, selection, and dock arrangement as bounded browser preferences. Derive the storage key from the signed-in account and repository identifiers. Validate restored structure and intersect tab identifiers with the current accessible snapshot. Keep document text and record bodies in the authorized snapshot response.

## Consequences

Two panes can represent the same document. A narrow viewport shows the focused leaf and drawers while preserving the saved tree. Layout restoration respects current document visibility. Counts describe indexed Markdown body source using whitespace-delimited words and Unicode code points.

## Affected files

- [Layout state](../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/layout-state.ts)
- [Workspace data](../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-data.ts)
- [Workspace context](../features/workspace-editor/CONTEXT.md)
