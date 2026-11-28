---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: verified-github-connections-2026-11-27
task_state: pr_open
task_revision: 126
repository_id: 1467144605
branch: feature/verified-github-connections
base_branch: main
pr_number: 23
pr_url: https://github.com/paddybanerjee09/nutshell/pull/23
last_verified_head: null
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

Forty-two focused tests passed, including the isolated PostgreSQL connection with controlled GitHub responses and zero outbound product calls. Serial strict types, lint and the optimized build passed. The running local fixture app rendered its repository and refused both live-only connection endpoints. Finish exact-head source checks.

## Affected files

- [Current authorization](features/auth-permissions/CONTEXT.md).
- [GitHub contract](architecture/GITHUB_CONTRACT.md).
- [System architecture](architecture/SYSTEM.md).
