---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: interactive-marketing-preview-2026-11-27
task_state: pr_open
task_revision: 80
repository_id: 1467144605
branch: feature/interactive-marketing-preview
base_branch: main
pr_number: 15
pr_url: https://github.com/paddybanerjee09/nutshell/pull/15
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Interactive marketing preview

## Context

Use the exact Nutshell marketing guide and original logo. Give the public entry page a synthetic editor and graph preview with useful, keyboard-accessible interactions.

## Decision

The public-entry delegate owns the hero and navigation. The preview delegate owns the interactive component and its styling. The sample delegate owns the bundled synthetic data and its isolation tests. The lead owns the browser verification, memory, commits, and source integration.

## Consequences

Durable history merged and canonical cleanup was confirmed at idle revision 77. Draft PR #15 is open. The bundled demo data passed two focused Markdown, graph, and isolation tests. Next verify the integrated page, keyboard controls, original logo response, and public isolation in Firefox.

## Affected files

- [Product overview](product/OVERVIEW.md).
- [UI guide](design/UI_GUIDE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
