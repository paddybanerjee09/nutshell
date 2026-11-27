---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: workspace-graphs-2026-11-27
task_state: ready_for_review
task_revision: 52
repository_id: 1467144605
branch: feature/workspace-graphs
base_branch: main
pr_number: 10
pr_url: https://github.com/paddybanerjee09/nutshell/pull/10
last_verified_head: 19eaaf3c944c73697580fc8b41e1df0942044a34
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

PR #10 passed lint, strict types, 19 focused graph and workspace tests, optimized build, the isolated indexed graph fixture, and the full local Firefox journey and signed provider checks. Desktop and 390-pixel screenshots were reviewed after the resize correction and the test verified both connected nodes stayed in the canvas. Next, verify the exact trusted source check, merge and confirm guarded canonical cleanup.

## Affected files

- [Workspace context](features/workspace-editor/CONTEXT.md)
- [Product history context](features/product-history/CONTEXT.md)
- [UI guide](design/UI_GUIDE.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
