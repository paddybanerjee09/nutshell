---
id: feature-workspace-editor
date: "2026-11-27"
status: active
tags: [feature, ui, editor, codemirror, graph]
---

## Context

The authorized workspace opens the latest available validated fixture snapshot. Its explorer lists actual nested vault paths and product entities. Read views show Markdown properties, links, backlinks, revision status, and declared changes from that snapshot.

## Decision

Follow [R-04 shell](../../../SPEC.md#7-r-04-workspace-shell-and-navigation), [R-05 Markdown editor](../../../SPEC.md#8-r-05-source-preserving-markdown-live-preview), and [R-07 graph modes](../../../SPEC.md#10-r-07-product-map-memory-graph-and-history). Honor UI_GUIDE exactly and preserve the supplied logo.

Use the [versioned workspace preference](../../decisions/2026-11-27-workspace-layout-preferences.md) for recursive panes and docks. Open actual accessible items and pane commands through the keyboard palette. Render Markdown with raw HTML disabled, internal links restricted to the current snapshot, and unavailable media labeled in the reading view.

The displayed workspace stays busy during layout restoration. Its pane, dock, and explorer controls accept input after restoration, so an initial action cannot be overwritten by saved preferences. The optimized verification checks the authenticated server markup without executing its scripts, then checks selection and evidence after browser hydration in the current page. This avoids allocating another Firefox context during the evidence journey.

The local draft API requires the current writer grant on every operation. Drafts are scoped by repository, connection epoch, author, and literal vault path. Saves require the exact current indexed commit and source digest with the expected draft version. PostgreSQL preserves the author's prior bytes on conflicts. Saving a draft leaves the published repository source unchanged.

New managed note paths exclude archive, decisions, templates, and reserved controls. The shared vault helper locates the single active index table and inserts one status- and tag-bearing row without changing the surrounding bytes. The source projector still validates the resulting tree.

A new draft records an explicit absent source blob at the exact indexed base. Writer-scoped listing and reads preserve the draft across sessions. The checked simulated proposal adds its literal file and catalog row, then reconstructs that exact candidate before merge. If the source appears or the base changes, the draft retains its text and reports a conflict.

Explorer and the command palette expose **New Markdown note** to current writers. Its form opens in the selected pane. Private drafts remain in their own explorer group while sharing the existing source editor, layout restoration, and proposal controls. Graphs and the canonical file tree continue to use the indexed snapshot.

CodeMirror decorates parsed Markdown over the original source. Live preview reveals raw tokens on the focused caret and selection lines and freezes the decoration set during composition. Source and Read remain available through the pane menu or command palette. Editor panes share one in-memory buffer per document. Unmodified mixed line endings are preserved, while pasted newlines follow a uniformly CRLF or CR document's existing separator.

The simulated provider stores a private proposal branch with an immutable checked candidate. Preparing or revising the proposal checks the saved draft version, exact base and blob, and expected proposal head. Explicit simulation revalidates the exact tree, preserves unaffected files, and delivers the new head through signed ingress. The merge consumes only the saved draft whose version and source match the candidate.

The workspace shows saved draft, simulated proposal, and indexed revision separately. The workspace marks a proposal indexed only after observing its exact published revision. Newer local text keeps its original source revision. Repository settings display a later verified head without treating it as the original setup revision.

The Memory Graph projects the same resolved links used by the note view and backlinks. The Product Map projects directed, typed relationships exactly as recorded by validated entities. Search and focus select a bounded visible graph from the indexed repository. Vault archive paths remain excluded from the default graph.

Both graph views open as ordinary workspace tabs and share a React Flow canvas. A bounded d3-force simulation arranges display positions. Pan, zoom, drag, and centering stay in the view. Search, filters, and a keyboard list provide the same node details. Reduced motion settles the graph without animated travel. The active canvas refits from its measured dimensions on geometry changes while retaining dragged node positions.

## Consequences

New managed notes, live-provider proposals, private media, semantic history, and the interactive marketing preview have separate implementation and acceptance work. Keep graph layout separate from canonical relationships and reuse shared domain services. Consult R-03 when changing the marketing preview.

## Affected files

- [UI_GUIDE.md](../../design/UI_GUIDE.md) and [logo](../../../assets/brand/nutshell-logo.png).
- [SPEC.md](../../../SPEC.md) and [SYSTEM.md](../../architecture/SYSTEM.md).
- [Proposal service](../../../packages/server/src/fixture-draft-proposals.ts) and [proposal route](../../../apps/web/src/app/api/repos/%5BrepositoryId%5D/draft-proposal/route.ts).
- [Draft store](../../../packages/server/src/fixture-drafts.ts) and [draft route](../../../apps/web/src/app/api/repos/%5BrepositoryId%5D/draft/route.ts).
- [Graph renderer](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph.tsx) and [graph panel](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph-panel.tsx).
- [Graph model](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-graph-model.ts).
- [CodeMirror editor](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/markdown-editor.tsx) and [preview parser tests](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/markdown-preview.test.ts).
- [Workspace shell](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-shell.tsx), [reading and metadata](../../../apps/web/src/app/app/repos/%5BrepositoryId%5D/workspace/workspace-content.tsx), and [browser verification](../../../scripts/local-browser.ts).
