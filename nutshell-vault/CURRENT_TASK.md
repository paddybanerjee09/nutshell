---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: trusted-change-validation-2026-11-27
task_state: ready_for_review
task_revision: 95
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

Draft PR #18 passed 68 focused tests, lint, strict root and build-time web checks, working-tree vault validation, the optimized Windows Firefox journey, a persisted worker probe, and signed fixture processing and shutdown. Controlled GitHub tests covered pointed base and head Checks. Next pass the exact source check, merge, and verify canonical cleanup.

## Affected files

- [Contract](architecture/GITHUB_CONTRACT.md).
- [GitHub synchronization context](features/github-sync/CONTEXT.md).
- [Memory context](features/memory-vault/CONTEXT.md).
- [Acceptance ledger](runs/ACCEPTANCE.md).
