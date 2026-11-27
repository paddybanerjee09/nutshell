---
id: feature-workspace-editor
date: "2026-11-26"
status: active
tags: [feature, ui, editor, codemirror, graph]
---

## Context

The authorized workspace opens the latest available validated fixture snapshot. Its explorer lists actual nested vault paths and product entities. Read views show Markdown properties, links, backlinks, revision status, and declared changes from that snapshot.

## Decision

Follow [R-04 shell](../../../SPEC.md#7-r-04-workspace-shell-and-navigation), [R-05 Markdown editor](../../../SPEC.md#8-r-05-source-preserving-markdown-live-preview), and [R-07 graph modes](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Honor UI_GUIDE exactly and preserve the supplied logo.

Use the [versioned workspace preference](../../decisions/2026-11-27-workspace-layout-preferences.md) for recursive panes and docks. Open actual accessible items and pane commands through the keyboard palette. Render Markdown with raw HTML disabled, internal links restricted to the current snapshot, and unavailable media labeled in the reading view.

## Consequences

CodeMirror source editing, private media, semantic history, and graph interaction have separate implementation and acceptance work. Keep graph layout separate from canonical relationships and reuse shared domain services. Consult R-03 when changing the marketing preview.

## Affected files

- [UI_GUIDE.md](../../design/UI_GUIDE.md) and [logo](../../../assets/brand/nutshell-logo.png).
- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- [Workspace shell](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-shell.tsx), [reading and metadata](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-content.tsx), and [browser verification](../../../scripts/local-browser.ts).
