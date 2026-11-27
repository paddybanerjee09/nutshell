---
id: feature-memory-vault
date: "2026-11-26"
status: active
tags: [feature, memory, retrieval, index]
---

## Context

The canonical folder is `nutshell-vault/`. The first validation slice checks managed Markdown in an explicit working-tree or immutable Git snapshot. Selective retrieval is planned.

## Decision

Follow [R-06 memory and retrieval](../../../SPEC.md#9-r-06-persistent-memory-and-selective-retrieval) and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md). After normal root AGENTS instructions, always read the single _INDEX router first, then CURRENT_TASK, then only relevant notes. Finalized decisions are dated; archive is excluded from default retrieval.

Run `pnpm nutshell validate --working-tree` for the current checkout or `pnpm nutshell validate --base <ref> --head <ref>` to validate the resolved Git head. The bounded reader supplies active notes and archived frontmatter to the shared index, metadata, and supersession validator. `--json` returns the scope, resolved source, and issues.

## Consequences

The Git path resolves both refs and checks the vault at the resolved head. Changed-path coverage, PR/task transition validation, provider proof, and query-based context ranking remain planned. See [the acceptance ledger](../../runs/ACCEPTANCE.md) for observed evidence.

## Affected files

- [_INDEX.md](../../_INDEX.md), [CURRENT_TASK.md](../../CURRENT_TASK.md), and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md).
- [Single-index decision](../../decisions/2026-11-26-single-index-active-task.md).
- [Shared vault validator](../../../packages/core/src/vault.ts).
- [Vault CLI](../../../packages/cli/src/main.ts) and [bounded checkout reader](../../../packages/cli/src/vault-files.ts).
