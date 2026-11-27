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
| A01 | Local setup and startup | Pass | Repeated `pnpm alpha:setup` migrated and seeded both databases. After the Windows supervisor repair, `pnpm alpha:dev` reached readiness, `GET http://127.0.0.1:3000/api/health` returned 200, and `pnpm alpha:stop` exited zero and removed the runtime control file. A queued pg-boss probe survived a worker restart. |
| A02 | Lint, typecheck, tests, optimized build | Pass | Windows `pnpm alpha:verify` exited zero with lint, strict typecheck, 48 tests, a fresh optimized Next.js build, a persisted worker job, and successful Playwright Firefox assertions and shutdown on [PR #3](https://github.com/paddybanerjee09/nutshell/pull/3). An independent Chromium probe reproduced the original process timeout. The same gate passed with 70 tests and the signed fixture scenario for [PR #4](https://github.com/paddybanerjee09/nutshell/pull/4). |
| A03 | Test database and reset isolation | Partial | Configuration tests verified explicit test database selection and refused the same database name for development and verification. The fixture reset command remains planned. |
| A04 | Sessions and protected surfaces | Partial | `NUTSHELL_VERIFY=1` server tests against PostgreSQL exercised real-session cookies, same-origin persona input, session persistence, and repository isolation across three fixture identities. The fixture snapshot HTTP journey returned 404 to a signed-out request and a session for the other repository. Further product surfaces remain unrun. |
| A05 | Revocation, delayed work, token authority | Partial | PostgreSQL tests verified that revoked membership, provider grants, installations, and sessions denied subsequent reads. `fixture-sync.test.ts` exercised stale queued work after fixture suspension, reactivation, and two connection epoch changes. Live provider token boundaries remain unrun. |
| A06 | Parser and bounded input validation | Pass | `repo-snapshot.test.ts` exercised incompatible schemas, duplicate IDs, unsafe path patterns, excessive inputs, invalid references, and hierarchy cycles using immutable source trees. The optimized fixture HTTP journey rejected an unsupported config revision. |
| A07 | Revision-aware retrieval and budget | Not run | No application run |
| A08 | Coverage and trusted validation policy | Partial | The default-branch workflow rejected the first draft without a PR association and reported `nutshell/source-task` success on PR #3's runnable head `c296cd3cbe5b9a9b2a1127da5c5c86639f220c4f`. [First GitHub run](https://github.com/paddybanerjee09/nutshell/actions/runs/45927166147). Changed-path coverage remains planned. |
| A09 | HMAC, duplicate events, recovery | Partial | The optimized local HTTP journey rejected an invalid HMAC, accepted a signed delivery and its duplicate, and published independently scoped snapshots through PostgreSQL and the worker. `fixture-sync.test.ts` exercised concurrent deduplication and obsolete heads. A worker restart with an unprocessed fixture receipt remains unrun. |
| A10 | Idempotent setup and simulated merge | Not run | No application run |
| A11 | Invalid snapshots and immutable history | Partial | The local fixture journey uploaded a different invalid tree, then read its `invalid` status and the exact preceding validated projection and revision. `fixture-sync.test.ts` rejected reusing a revision for a different tree. Accepted semantic history across later edits remains unrun. |
| A12 | Exact brand and visual contract | Partial | Inspected the entry at 1440×900 and sign-in at 390×844. The exact slogan and full artwork rendered, and the built PNG's SHA-256 matched the original. Workspace and interactive preview checks remain outstanding. |
| A13 | Shell, panes, docking, layout | Not run | No application run |
| A14 | Markdown source-preserving editing | Not run | No application run |
| A15 | Drafts, proposals, and edit conflicts | Not run | No application run |
| A16 | Memory Graph and Product Map | Not run | No application run |
| A17 | Command palette and focus | Not run | No application run |
| A18 | Task persistence and permissions | Not run | No application run |
| A19 | Notes and optimistic conflicts | Not run | No application run |
| A20 | Private media and evidence state | Not run | No application run |
| A21 | Marketing and synthetic preview | Partial | Chromium followed the marketing CTA into the local sign-in flow. The interactive editor and graph preview remains planned. |
| A22 | Mode and exposure guards | Partial | Configuration tests refused implicit modes, hosted fixture access, non-loopback origins, and unavailable live mode. The optimized local web bound to 127.0.0.1:3001. |
| A23 | Live-adapter controlled contract tests | Not run | No application run |
| A24 | Complete local browser journey | Partial | Playwright 1.65.1 with Firefox 159.0 on Windows passed local sign-in, session reload, authorized repository entry, denial across two fixture identities, and browser shutdown on the optimized build. Vault editing, proposal/merge, collaboration, and graph journeys remain unrun. |
| A25 | Truthful memory, commits, and handoff | Partial | Starter and validator use source [PR #1](https://github.com/paddybanerjee09/nutshell/pull/1). The web/worker handoff remains outstanding. |
| A26 | Exact active index coverage and routed body reads | Partial | `pnpm nutshell validate --working-tree` checked the current catalog. Vitest fixtures exercised missing, duplicate, stale, and inactive entries. Query-based body selection remains unrun. |
| A27 | One lead-owned task and guarded revisions | Partial | `pnpm test` exercised an idle-to-feature transition, exact provider identity, a competing active task, and stale revisions. The source workflow runs on GitHub after its first merge. |
| A28 | Relevant decisions, unique keys, and supersession | Partial | Validator fixtures reject duplicate accepted keys and broken supersession links. The starter's mismatched backlink was corrected. Decision retrieval remains unrun. |
| A29 | Metadata, four headings, and length policy | Pass | `pnpm test` exercised note metadata, exact H2 headings including fenced examples, and length policy; `pnpm nutshell validate --working-tree` passed the managed vault. |
| A30 | Default archive exclusion and explicit history | Not run | No application retrieval or graph run |
| A31 | Real source PR proof and guarded canonical cleanup | Partial | [PR #1](https://github.com/paddybanerjee09/nutshell/pull/1), [PR #2](https://github.com/paddybanerjee09/nutshell/pull/2), and [PR #3](https://github.com/paddybanerjee09/nutshell/pull/3) merged with verified one-file cleanups at idle revisions 4, 8, and 16. [PR #4](https://github.com/paddybanerjee09/nutshell/pull/4) passed the trusted check on `97d7d1dd113479e153974af6b60e2a4beb094082` and GitHub confirmed merge `3bba292f3536d98482088f166d005e591b50ac3a` and expected-head one-file cleanup `3a97917ba2907191d14a3b54f1df975e0301cae6` at idle revision 21. No required main-branch checks or reviews were configured. |
| Live | Actual GitHub and external acceptance | Not run | No live setup or acceptance |

## Consequences

A note's active status means the ledger is current, not that any gate passed. Synthetic review is not human review. Do not infer a PR merge or deployment from tests. Do not embed the final SHA of the commit containing this ledger.

Finalized decisions belong in dated decision notes. Current plan, branch/PR state, progress, and blockers belong only in CURRENT_TASK. Historical evidence may be investigated explicitly; archive is excluded by default.

## Affected files

- [SPEC.md](../../SPEC.md#17-acceptance-matrix) — authoritative gates.
- [CURRENT_TASK.md](../CURRENT_TASK.md) — active work and next step.
- Actual source/test paths and evidence artifacts when they exist; none are asserted here.
