---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: verified-github-connections-2026-11-27
task_state: ready_for_review
task_revision: 127
repository_id: 1467144605
branch: feature/verified-github-connections
base_branch: main
pr_number: 23
pr_url: https://github.com/paddybanerjee09/nutshell/pull/23
last_verified_head: c4a6098e54b03ff4a4c991acbead9f27ce95d646
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Verified GitHub connections

## Context

Discover repositories that the signed-in GitHub user can access through the configured App and persist an explicit verified local association.

## Decision

Verify the linked GitHub identity, repository and installation using provider responses. Require current configuration authority to bootstrap an association and preserve local revocation and stable owner boundaries. Keep consent and provider operations distinct from source GitHub credentials.

## Consequences

The exact code head passed 42 scoped tests and vault validation, including an isolated PostgreSQL connection with controlled GitHub responses and zero outbound product calls. Serial strict types, lint, optimized build and fixture-mode HTTP isolation passed. Confirm the latest trusted source checks and merge, then clear only this matching task.

## Affected files

- [Current authorization](features/auth-permissions/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
