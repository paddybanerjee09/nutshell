---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: interactive-marketing-preview-2026-11-27
task_state: in_progress
task_revision: 78
repository_id: 1467144605
branch: feature/interactive-marketing-preview
base_branch: main
pr_number: null
pr_url: null
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

Durable history merged and canonical cleanup was confirmed at idle revision 77. Next open the draft source PR and integrate the public preview.

## Affected files

- [Product overview](product/OVERVIEW.md).
- [UI guide](design/UI_GUIDE.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
