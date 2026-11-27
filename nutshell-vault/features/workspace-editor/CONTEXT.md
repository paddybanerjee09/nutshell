---
id: feature-workspace-editor
date: "2026-11-26"
status: planned
tags: [feature, ui, editor, codemirror, graph]
---

## Context

Planned feature only. No application shell, editor, graph, or visual acceptance is implemented. Scope covers the workspace shell, CodeMirror, and focused graph views.

## Decision

Follow [R-04 shell](../../../SPEC.md#7-r-04-workspace-shell-and-navigation), [R-05 Markdown editor](../../../SPEC.md#8-r-05-source-preserving-markdown-live-preview), and [R-07 graph modes](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Honor UI_GUIDE exactly and preserve the supplied logo.

## Consequences

Design references do not establish working behavior. Keep graph layout separate from canonical relationships and reuse shared domain services. Relevant gates: A12–A17. Consult R-03 when changing the shared marketing preview.

## Affected files

- [UI_GUIDE.md](../../design/UI_GUIDE.md) and [logo](../../../assets/brand/nutshell-logo.png).
- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- Actual component, service, and test paths: not established.
