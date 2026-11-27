---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: configured-github-access-2026-11-27
task_state: in_progress
task_revision: 88
repository_id: 1467144605
branch: feature/configured-github-access
base_branch: main
pr_number: null
pr_url: null
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

GitHub confirmed PR #16 merged and the one-file canonical cleanup advanced to idle revision 87. No external product App credentials are present. Verify this runtime slice with controlled responses and preserve the full Windows fixture journey.

## Affected files

- [Auth and permissions context](features/auth-permissions/CONTEXT.md).
- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
