---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: trusted-change-validation-2026-11-27
task_state: pr_open
task_revision: 93
repository_id: 1467144605
branch: feature/trusted-change-validation
base_branch: main
pr_number: 18
pr_url: https://github.com/paddybanerjee09/nutshell/pull/18
last_verified_head: null
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Trusted change validation

## Context

Diagnose covered changes and their product classifications from immutable base and candidate trees. Keep the policy independent of candidate config, exclusions, and validator scripts.

## Decision

One delegate owns changed-path policy and tests. One delegate owns the immutable Git CLI comparison. One delegate owns exact-head GitHub comparison inputs. The lead integrates shared contracts, simulated checks, and verification.

## Consequences

GitHub confirmed PR #17 merged and its guarded canonical cleanup advanced to idle revision 91. Draft PR #18 is open. Record contract behavior with controlled inputs and a local Git comparison. External product Check acceptance remains unrun.

## Affected files

- [Contract](architecture/GITHUB_CONTRACT.md).
- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
