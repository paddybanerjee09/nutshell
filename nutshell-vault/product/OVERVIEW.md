---
id: product-overview
date: "2026-11-26"
status: planned
tags: [product, purpose, scope, brand]
---

## Context

**Nutshell — Your codebase. In a Nutshell.**

Nutshell helps technical and nontechnical teammates understand AI-assisted GitHub projects. Delegated coding can leave people uncertain about architecture, product behavior, changes, and decisions. This deliverable is a starter workspace; no implemented application is claimed.

## Decision

Connect concise shared repository memory with product history, a workspace editor and graph, and lightweight tasks and notes. Agents update relevant knowledge alongside code, with source links and explicit uncertainty.

Use the local-first execution decision in [the finalized note](../decisions/2026-11-26-local-alpha-execution.md). [SPEC.md](../../SPEC.md) owns scope, stack, and acceptance. Follow [UI_GUIDE.md](../design/UI_GUIDE.md) exactly; preserve the supplied logo and exact name/slogan.

## Consequences

The future alpha should exercise real local domain behavior while keeping live-provider acceptance separate. Reuse domain logic. A graph or generated explanation does not prove architectural correctness.

After normal root AGENTS instructions, read _INDEX first, then CURRENT_TASK; retrieve only relevant feature context and finalized decisions. No application or provider tests are established by this overview.

## Affected files

- [SPEC.md](../../SPEC.md) — requirements and completion gates.
- [UI_GUIDE.md](../design/UI_GUIDE.md) — visual contract.
- [Logo](../../assets/brand/nutshell-logo.png) — supplied original, unchanged.
- [_INDEX.md](../_INDEX.md), [CURRENT_TASK.md](../CURRENT_TASK.md), and relevant indexed feature notes.
