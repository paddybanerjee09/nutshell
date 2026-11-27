---
id: feature-memory-vault
date: "2026-11-26"
status: active
tags: [feature, memory, retrieval, index]
---

## Context

The canonical folder is `nutshell-vault/`. The validator checks managed Markdown in an explicit working-tree or immutable Git snapshot. The source PR workflow validates the lead-owned task and its GitHub PR association. The context command reads the two mandatory controls and retrieves ranked excerpts from one selected source.

## Decision

Follow [R-06 memory and retrieval](../../../SPEC.md#9-r-06-persistent-memory-and-selective-retrieval) and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md). After normal root AGENTS instructions, always read the single _INDEX router first, then CURRENT_TASK, then only relevant notes. Finalized decisions are dated; archive is excluded from default retrieval.

Run `pnpm nutshell validate --working-tree` for the current checkout or `pnpm nutshell validate --base <ref> --head <ref>` to validate the resolved Git head. The bounded reader supplies active notes and archived frontmatter to the shared index, metadata, and supersession validator. `--json` returns the scope, resolved source, and issues.

Use `pnpm nutshell context --query <text> --budget <estimated tokens>` for Git HEAD. Add `--ref <ref>` or `--working-tree` to select a source explicitly, `--paths` for comma-separated repository paths, and `--json` for structured output. [The context budget decision](../../decisions/2026-11-27-vault-context-budget.md) defines whole-control budgeting and the history boundary.

## Consequences

The Git validator resolves both refs and checks the vault at the resolved head. The trusted source workflow checks the task revision and observed PR identity. Housekeeping validates the matching merge, canonical task blob, and one-file scope before GitHub applies its expected-head guard. Revision-aware context retrieval surfaces catalog problems and budget limits. Changed-path coverage remains planned. See [the acceptance ledger](../../runs/ACCEPTANCE.md) for observed evidence.

## Affected files

- [_INDEX.md](../../_INDEX.md), [CURRENT_TASK.md](../../CURRENT_TASK.md), and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md).
- [Single-index decision](../../decisions/2026-11-26-single-index-active-task.md).
- [Shared vault validator](../../../packages/core/src/vault.ts).
- [Vault CLI](../../../packages/cli/src/main.ts) and [bounded checkout reader](../../../packages/cli/src/vault-files.ts).
- [Context retrieval](../../../packages/core/src/context-retrieval.ts) and [revision source adapter](../../../packages/cli/src/context-source.ts).
- [Source task policy](../../../packages/core/src/source-task.ts), [trusted runner](../../../packages/cli/src/source-check.ts), and [source workflow](../../../.github/workflows/source-task.yml).
