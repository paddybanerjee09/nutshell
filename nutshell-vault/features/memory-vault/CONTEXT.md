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

`pnpm nutshell init` previews local repository setup. `--write` creates the verified managed files and directories and preserves existing owner instructions. An existing valid vault with indexed owner instructions retains its catalog and notes. Setup records use its existing setup context or index. If an existing catalog has no AGENTS entry or file, add them before applying setup to preserve ownership of the catalog. `pnpm nutshell change add` validates noninteractive inputs against the current working tree and creates one fresh semantic record. `--help` describes its required fields, repeatable entity and memory references, and optional correction or reversal.

Run `pnpm nutshell validate --working-tree` for the current vault or `pnpm nutshell validate --base <ref> --head <ref>` for an immutable comparison. The bounded reader supplies active notes and archived frontmatter to the shared index, metadata, and supersession validator. With product records present, the Git comparison also checks source coverage and new change declarations. Use `pnpm nutshell impact --base <ref> --head <ref>` for changed paths, mapped entities, related memory, and diagnostics. `--json` returns the scope, resolved source, and issues.

When only prior change references disappeared from the current view, local authoring and comparison can recover them by replaying up to 64 record-changing revisions along the selected commit's first-parent history. Each revision must pass the shared snapshot checks. The working copy must retain the exact event payload. Current records still need active references, and provider checks use their own verified accepted history.

Use `pnpm nutshell context --query <text> --budget <estimated tokens>` for Git HEAD. Add `--ref <ref>` or `--working-tree` to select a source explicitly, `--paths` for comma-separated repository paths, and `--json` for structured output. [The context budget decision](../../decisions/2026-11-27-vault-context-budget.md) defines whole-control budgeting and the history boundary.

## Consequences

The Git validator resolves both refs before reading either tree. Protected record parsing uses service code. Configured comparisons use the base coverage. Initial setup retains the service-owned coverage floor for future changes. A proposed weakening requires separate approval. The trusted source workflow checks the task revision and actual PR identity. Housekeeping validates the matching merge, canonical task blob, and one-file scope before GitHub applies its expected-head guard. Revision-aware context retrieval surfaces catalog problems and budget limits. See [the acceptance ledger](../../runs/ACCEPTANCE.md) for observed evidence.

## Affected files

- [_INDEX.md](../../_INDEX.md), [CURRENT_TASK.md](../../CURRENT_TASK.md), and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md).
- [Single-index decision](../../decisions/2026-11-26-single-index-active-task.md).
- [Shared vault validator](../../../packages/core/src/vault.ts).
- [Shared changed-path policy](../../../packages/core/src/repository-change-validation.ts).
- [Vault CLI](../../../packages/cli/src/main.ts) and [bounded checkout reader](../../../packages/cli/src/vault-files.ts).
- [Repository initialization](../../../packages/cli/src/init-command.ts), [semantic change authoring](../../../packages/cli/src/change-command.ts), and [scoped local file operations](../../../packages/cli/src/authoring-files.ts).
- [Context retrieval](../../../packages/core/src/context-retrieval.ts) and [revision source adapter](../../../packages/cli/src/context-source.ts).
- [Source task policy](../../../packages/core/src/source-task.ts), [trusted runner](../../../packages/cli/src/source-check.ts), and [source workflow](../../../.github/workflows/source-task.yml).
