---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: configured-github-access-2026-11-27
task_state: ready_for_review
task_revision: 90
repository_id: 1467144605
branch: feature/configured-github-access
base_branch: main
pr_number: 17
pr_url: https://github.com/paddybanerjee09/nutshell/pull/17
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Configured GitHub access

## Context

Wire explicit live configuration and GitHub App sign-in to the web runtime. Enforce current provider grants and stable repository ownership alongside a local association. Keep synthetic entry points local and fail closed through unimplemented provider operations.

## Decision

The configuration delegate owns explicit mode, origin and isolated connection checks. The repository delegate owns current user authorization for stored live associations. The web delegate owns the mode-specific sign-in and repository entry surfaces. The lead owns runtime integration, shared schema and verification.

## Consequences

Draft PR #17 has 36 passing focused tests, strict TypeScript, migrated local databases, and an optimized Windows Firefox and persisted-worker run. The repaired Markdown test binds keys to the intended note and pane and confirms shared edits. The fresh live-mode PostgreSQL smoke used controlled OAuth initiation and no external provider requests. Next pass the exact source check, merge, and verify canonical cleanup.

## Affected files

- [Auth and permissions context](features/auth-permissions/CONTEXT.md).
- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
