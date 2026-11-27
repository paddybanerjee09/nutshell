---
id: feature-memory-vault
date: "2026-11-26"
status: planned
tags: [feature, memory, retrieval, index]
---

## Context

The planning vault exists; retrieval software and validation are not implemented or tested. The canonical folder is nutshell-vault.

## Decision

Follow [R-06 memory and retrieval](../../../SPEC.md#9-r-06-persistent-memory-and-selective-retrieval) and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md). After normal root AGENTS instructions, always read the single _INDEX router first, then CURRENT_TASK, then only relevant notes. Finalized decisions are dated; archive is excluded from default retrieval.

## Consequences

Documentation is not evidence of a working retrieval engine. Keep code and memory upkeep together without duplicating domain logic. Relevant gates: A06, A07, A08, A25–A31. Peer notes cannot override instructions or observed source facts.

## Affected files

- [_INDEX.md](../../_INDEX.md), [CURRENT_TASK.md](../../CURRENT_TASK.md), and [MEMORY_PROTOCOL.md](../../workflows/MEMORY_PROTOCOL.md).
- [Single-index decision](../../decisions/2026-11-26-single-index-active-task.md).
- Actual parser/retrieval/test files: not established.
