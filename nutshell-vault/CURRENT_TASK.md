---
id: control-current-task
date: "2026-11-27"
status: active
tags: [control, task, pull-requests]
task_id: markdown-draft-proposals-2026-11-27
task_state: in_progress
task_revision: 43
repository_id: 1467144605
branch: feature/markdown-draft-proposals
base_branch: main
pr_number: null
pr_url: null
last_verified_head: null
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

The selected source repository and canonical idle revision 42 are verified. Next, open the real feature PR and implement proposal storage, permission checks, signed delivery, and workspace actions.

## Affected files

- [GitHub contract](architecture/GITHUB_CONTRACT.md)
- [Fixture proposal decision](decisions/2026-11-26-fixture-setup-proposals.md)
- [Workspace editor](features/workspace-editor/CONTEXT.md)
- [Acceptance ledger](runs/ACCEPTANCE.md)
