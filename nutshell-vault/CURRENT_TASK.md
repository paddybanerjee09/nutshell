---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: workspace-graphs-2026-11-27
task_state: pr_open
task_revision: 50
repository_id: 1467144605
branch: feature/workspace-graphs
base_branch: main
pr_number: 10
pr_url: https://github.com/paddybanerjee09/nutshell/pull/10
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Workspace Memory Graph and Product Map

## Context

Provide a Memory Graph of resolved vault-note links and a Product Map of declared typed relationships from the authorized indexed repository.

## Decision

Use one React Flow renderer with bounded d3-force layout, distinct graph semantics, keyboard list navigation, filtering, selection and centering, and the documented reduced-motion controls.

## Consequences

Source PR #10 has pinned graph dependencies and a tested bounded model. Five model tests passed. The isolated PostgreSQL fixture validated its declared edge and archive exclusion. Next, integrate the force renderer and workspace navigation and run the browser journey.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md)
- [Product history context](features/product-history/CONTEXT.md)
- [UI guide](design/UI_GUIDE.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
