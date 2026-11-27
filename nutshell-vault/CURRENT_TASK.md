---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: private-screenshot-evidence-2026-11-27
task_state: pr_open
task_revision: 69
repository_id: 1467144605
branch: feature/private-screenshot-evidence
base_branch: main
pr_number: 13
pr_url: https://github.com/paddybanerjee09/nutshell/pull/13
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Private screenshot evidence

## Context

Implement repository-scoped raster upload and proxy delivery, observable unavailable evidence, and provenance that distinguishes declared images from controlled fixture captures.

## Decision

The service delegate owns asset storage and authorization, the HTTP delegate owns the bounded raster decoder and proxy routes, and the UI delegate owns the related workspace controls and evidence display. The lead owns source integration, dependency lock, browser verification, and memory in this checkout.

## Consequences

Team notes merged and canonical cleanup was confirmed at idle revision 66. Draft PR #13 is open. Private storage, decoder, and authorization tests passed on the isolated database. The 5 scoped route and 4 raster tests passed. Next integrate the workspace and exercise the complete browser and signed-fixture journey.

## Affected files

- [Product history and evidence context](features/product-history/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
