---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: private-screenshot-evidence-2026-11-27
task_state: ready_for_review
task_revision: 70
repository_id: 1467144605
branch: feature/private-screenshot-evidence
base_branch: main
pr_number: 13
pr_url: https://github.com/paddybanerjee09/nutshell/pull/13
last_verified_head: 0864c06f390aab810c7ba4790c63e461b0727856
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

Migration 0007 passed on both databases. Eleven focused PostgreSQL, raster, and route tests passed. Lint, strict types, the optimized build, persisted worker, signed fixture flows, and real Firefox passed with private image delivery and distinct declared, fixture capture, and unavailable states. Next verify the exact GitHub head before merge and guarded cleanup.

## Affected files

- [Product history and evidence context](features/product-history/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
