---
id: decision-vault-context-budget
date: "2026-11-27"
status: accepted
tags: [decision, memory, retrieval, budget]
decision_key: memory.context-budget
---

## Context

The context command retrieves a bounded set of notes from one checkout revision. The index and current task provide mandatory guidance. Query routing relies on catalog metadata and explicit path selectors.

## Decision

Use Git HEAD by default, with explicit ref and working-tree modes. Budget content in estimated tokens using UTF-8 bytes divided by four and rounded up. Count the complete control bodies before selecting sections. Rank catalog metadata before reading candidate bodies and limit link expansion to one hop. An explicit archive query returns labeled historical excerpts with lifecycle and replacement data.

## Consequences

Retrieval retains revision provenance and reports budget exhaustion, no matches, and catalog gaps. A working-tree query reflects local files. Historical results have a dedicated list and follow the current notes within the same content budget.

## Affected files

- [Context retrieval](../../packages/core/src/context-retrieval.ts)
- [Bounded source adapter](../../packages/cli/src/context-source.ts)
- [CLI context command](../../packages/cli/src/context-command.ts)
