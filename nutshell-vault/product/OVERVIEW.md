---
id: product-overview
date: "2026-11-27"
status: active
tags: [product, purpose, scope, brand]
---

## Context

**Nutshell — Your codebase. In a Nutshell.**

Nutshell helps technical and nontechnical teammates understand AI-assisted GitHub projects. The local alpha brings repository memory, product history, drafting, and collaboration into one workspace.

## Decision

Connect concise shared repository memory with product history, a workspace editor and graph, and lightweight tasks and notes. Agents update relevant knowledge alongside code, with source links and explicit uncertainty.

Use the local-first execution decision in [the finalized note](../decisions/2026-11-26-local-alpha-execution.md). [SPEC.md](../../SPEC.md) owns scope, stack, and acceptance. Follow [UI_GUIDE.md](../design/UI_GUIDE.md) exactly; preserve the supplied logo and exact name/slogan.

The public landing page uses the original logo and a bundled Orbit Garden demo. The preview reuses the read-only Markdown editor and Memory Graph. Visitors can switch notes, follow connections, and open an uncropped view. Its data comes from bundled synthetic notes.

## Consequences

The [acceptance ledger](../runs/ACCEPTANCE.md) has observed application, simulated-provider, live-provider, and source-PR results. Use source links and evidence to interpret product and architecture claims.

## Affected files

- [SPEC.md](../../SPEC.md) — requirements and completion gates.
- [UI_GUIDE.md](../design/UI_GUIDE.md) — visual contract.
- [Logo](../../assets/brand/nutshell-logo.png) — supplied original, unchanged.
- [Public entry](../../apps/web/src/app/page.tsx) and [demo dataset](../../apps/web/src/app/marketing-preview-data.ts).
- [_INDEX.md](../_INDEX.md), [CURRENT_TASK.md](../CURRENT_TASK.md), and relevant indexed feature notes.
