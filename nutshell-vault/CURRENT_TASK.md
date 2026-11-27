---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: markdown-draft-proposals-2026-11-27
task_state: ready_for_review
task_revision: 46
repository_id: 1467144605
branch: feature/markdown-draft-proposals
base_branch: main
pr_number: 9
pr_url: https://github.com/paddybanerjee09/nutshell/pull/9
last_verified_head: dbea61bea48526cd0cde282830240bc84ef17eb0
lead_agent: root
integration_checkout: 'C:\Users\paddy\dev\nutshell'
cleanup_pr_url: null
---
# Markdown draft proposals

## Context

Allow an authorized writer to propose saved Markdown from an existing vault note through the local simulated provider. Keep the candidate and its expected revision separate from published source.

## Decision

Validate one immutable candidate revision against the current draft version, base commit and blob. Publish only after explicit simulated merge checks the candidate and current base, then enters the signed receipt and outbox path.

## Consequences

Source PR #9 passed lint, strict types, the optimized app build, 19 scoped tests, migration on both local databases, a persisted worker job, and the signed fixture and Firefox journey. The browser checked invalid-candidate refusal, idempotent retries, exact publication, and graceful shutdown. Next, confirm the trusted check, merge the exact PR, and verify canonical cleanup.

## Affected files

- [GitHub contract](architecture/GITHUB_CONTRACT.md)
- [Fixture proposal decision](decisions/2026-11-26-fixture-setup-proposals.md)
- [Workspace editor](features/workspace-editor/CONTEXT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
