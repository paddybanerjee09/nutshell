---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: interactive-marketing-preview-2026-11-27
task_state: ready_for_review
task_revision: 81
repository_id: 1467144605
branch: feature/interactive-marketing-preview
base_branch: main
pr_number: 15
pr_url: https://github.com/paddybanerjee09/nutshell/pull/15
last_verified_head: 7550a857335ff33458696aa9fe4bf57f06fef117
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

The focused dataset tests, lint, strict types, optimized build, persisted worker, Firefox entry and full app journey, signed fixtures, and scoped shutdown passed. Firefox confirmed the repair for clipped selected-graph actions and checked the unchanged served PNG, demo interactions, reduced and offscreen graph motion, mobile dialog focus, and public isolation. Native zoom remains unrun after Windows automation timeouts. Next verify the exact GitHub head before merge and guarded cleanup.

## Affected files

- [Product overview](product/OVERVIEW.md).
- [UI guide](design/UI_GUIDE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
