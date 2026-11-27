---
id: run-acceptance-evidence
date: "2026-11-26"
status: active
tags: [verification, acceptance, evidence]
---

## Context

[SPEC.md](../../SPEC.md#17-acceptance-matrix) owns the acceptance gates. This operational ledger records observed setup and verification. Infrastructure checks cover tool readiness.

## Decision

Record the exact command or reproducible action, relevant paths/revision, observed result, and local/simulated/live evidence class when a check runs. Keep failed, blocked, and unrun results visible. Update only affected rows; the lead coordinates shared edits.

| Gate | Area | Status | Evidence |
| --- | --- | --- | --- |
| A01 | Local setup and startup | Partial | Node 24.18.0 and pnpm 11.25.0 ran. PostgreSQL 18.7 authenticated on 127.0.0.1:55432 and preserved a test row through restart. Alpha setup, migrations, web, and worker remain unrun. See [local setup](../workflows/LOCAL_SETUP.md#observed-on-the-windows-development-machine). |
| A02 | Lint, typecheck, tests, optimized build | Partial | `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed for the vault validator and CLI. Optimized web build remains unrun. |
| A03 | Test database and reset isolation | Not run | No application run |
| A04 | Sessions and protected surfaces | Not run | No application run |
| A05 | Revocation, delayed work, token authority | Not run | No application run |
| A06 | Parser and bounded input validation | Not run | No application run |
| A07 | Revision-aware retrieval and budget | Not run | No application run |
| A08 | Coverage and trusted validation policy | Not run | No application run |
| A09 | HMAC, duplicate events, recovery | Not run | No application run |
| A10 | Idempotent setup and simulated merge | Not run | No application run |
| A11 | Invalid snapshots and immutable history | Not run | No application run |
| A12 | Exact brand and visual contract | Not run | No rendered application |
| A13 | Shell, panes, docking, layout | Not run | No application run |
| A14 | Markdown source-preserving editing | Not run | No application run |
| A15 | Drafts, proposals, and edit conflicts | Not run | No application run |
| A16 | Memory Graph and Product Map | Not run | No application run |
| A17 | Command palette and focus | Not run | No application run |
| A18 | Task persistence and permissions | Not run | No application run |
| A19 | Notes and optimistic conflicts | Not run | No application run |
| A20 | Private media and evidence state | Not run | No application run |
| A21 | Marketing and synthetic preview | Not run | No application run |
| A22 | Mode and exposure guards | Not run | No application run |
| A23 | Live-adapter controlled contract tests | Not run | No application run |
| A24 | Complete local browser journey | Not run | Playwright 1.65.1 launched Chrome Headless Shell 159.0.8154.6 and exercised a test form. No application browser journey. |
| A25 | Truthful memory, commits, and handoff | Partial | Starter and validator use source [PR #1](https://github.com/paddybanerjee09/nutshell/pull/1). The web/worker handoff remains outstanding. |
| A26 | Exact active index coverage and routed body reads | Partial | `pnpm nutshell validate --working-tree` checked the current catalog. Vitest fixtures exercised missing, duplicate, stale, and inactive entries. Query-based body selection remains unrun. |
| A27 | One lead-owned task and guarded revisions | Not run | No task lifecycle implementation run |
| A28 | Relevant decisions, unique keys, and supersession | Partial | Validator fixtures reject duplicate accepted keys and broken supersession links. The starter's mismatched backlink was corrected. Decision retrieval remains unrun. |
| A29 | Metadata, four headings, and length policy | Pass | `pnpm test` exercised note metadata, exact H2 headings including fenced examples, and length policy; `pnpm nutshell validate --working-tree` passed the managed vault. |
| A30 | Default archive exclusion and explicit history | Not run | No application retrieval or graph run |
| A31 | Real source PR proof and guarded canonical cleanup | Partial | Authenticated push and [draft source PR #1](https://github.com/paddybanerjee09/nutshell/pull/1) observed at `ecd6576e5cdce6e14eb0d0838c51a70ed00efa46`. Main was unprotected and had no applicable rulesets or required checks. Merge, canonical cleanup, and negative lifecycle fixtures remain unrun. |
| Live | Actual GitHub and external acceptance | Not run | No live setup or acceptance |

## Consequences

A note's active status means the ledger is current, not that any gate passed. Synthetic review is not human review. Do not infer a PR merge or deployment from tests. Do not embed the final SHA of the commit containing this ledger.

Finalized decisions belong in dated decision notes. Current plan, branch/PR state, progress, and blockers belong only in CURRENT_TASK. Historical evidence may be investigated explicitly; archive is excluded by default.

## Affected files

- [SPEC.md](../../SPEC.md#17-acceptance-matrix) — authoritative gates.
- [CURRENT_TASK.md](../CURRENT_TASK.md) — active work and next step.
- Actual source/test paths and evidence artifacts when they exist; none are asserted here.
