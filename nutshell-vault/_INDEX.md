---
id: control-vault-index
date: "2026-11-26"
status: active
tags: [control, index, routing, retrieval]
---
# Active memory index

## Context

Read this file first after applicable agent instructions, then [CURRENT_TASK.md](CURRENT_TASK.md). Use paths, descriptions, and tags below to select only the context relevant to the task. The [acceptance ledger](runs/ACCEPTANCE.md) records observed implementation and verification.

## Decision

This is the sole router. Every active managed Markdown file has exactly one row, including these control files, templates, and the root handoff documents. Finalized decisions are loaded only for relevant subsystems. Archive contents are deliberately absent.

| Path | Description | Status | Tags |
| --- | --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Agent reading order, sole task writer, feature PRs, small commits, and note upkeep. | active | instructions, workflow, memory |
| [SPEC.md](../SPEC.md) | Complete local-alpha requirements, stack, revised memory system, milestones, and acceptance gates. | active | handoff, requirements, alpha |
| [README.md](../README.md) | Local startup, source PR prerequisites, workspace contents, and first-run prompt. | active | onboarding, setup, handoff |
| [nutshell-vault/_INDEX.md](_INDEX.md) | Sole routing catalog of all active managed Markdown files. | active | control, index, routing, retrieval |
| [nutshell-vault/CURRENT_TASK.md](CURRENT_TASK.md) | One current feature brief and observed PR state; initially idle. | active | control, task, pull-requests |
| [nutshell-vault/architecture/GITHUB_CONTRACT.md](architecture/GITHUB_CONTRACT.md) | Repository record schemas, provenance, GitHub authority, checks, and synchronization semantics. | active | architecture, github, repository-format, provenance |
| [nutshell-vault/architecture/SOURCES.md](architecture/SOURCES.md) | Primary GitHub references for permissions, events, checks, merge status, and rulesets. | active | architecture, sources, github, authentication |
| [nutshell-vault/architecture/STACK_SOURCES.md](architecture/STACK_SOURCES.md) | Primary references for the selected implementation stack and runtime tooling. | active | architecture, sources, stack, runtime |
| [nutshell-vault/architecture/SYSTEM.md](architecture/SYSTEM.md) | Runtime boundaries, storage ownership, access checks, and durable synchronization. | active | architecture, runtime, storage, authorization |
| [nutshell-vault/decisions/2026-11-26-local-alpha-execution.md](decisions/2026-11-26-local-alpha-execution.md) | Finalized local execution scope and separation of source PRs from product credentials. | accepted | decision, architecture, local-alpha, integration |
| [nutshell-vault/decisions/2026-11-26-single-index-active-task.md](decisions/2026-11-26-single-index-active-task.md) | Finalized single-router, single-task, relevant-decision, and archive workflow. | accepted | decision, workflow, memory, retrieval |
| [nutshell-vault/design/BRAND.md](design/BRAND.md) | Exact product name, slogan, supplied logo, and asset placement. | active | design, brand, assets |
| [nutshell-vault/design/UI_ACCEPTANCE.md](design/UI_ACCEPTANCE.md) | Visual review, viewport, keyboard, contrast, and accessibility verification requirements. | active | design, ui, qa, contrast, accessibility |
| [nutshell-vault/design/UI_GUIDE.md](design/UI_GUIDE.md) | The fifteen exact visual and interaction requirements supplied by the user. | active | design, ui, source-spec |
| [nutshell-vault/design/UI_IMPLEMENTATION.md](design/UI_IMPLEMENTATION.md) | Implementation details for panes, editor, graph, typography, and responsive behavior. | active | design, ui, interaction, markdown, accessibility |
| [nutshell-vault/features/auth-permissions/CONTEXT.md](features/auth-permissions/CONTEXT.md) | Planned authentication, repository permissions, and isolation behavior. | planned | feature, auth, permissions, isolation |
| [nutshell-vault/features/github-sync/CONTEXT.md](features/github-sync/CONTEXT.md) | Planned provider integration, durable synchronization, and failure handling. | planned | feature, github, synchronization, provider |
| [nutshell-vault/features/memory-vault/CONTEXT.md](features/memory-vault/CONTEXT.md) | Vault snapshot validation and planned selective retrieval and task validation. | active | feature, memory, retrieval, index |
| [nutshell-vault/features/product-history/CONTEXT.md](features/product-history/CONTEXT.md) | Planned product entities, semantic history, and evidence presentation. | planned | feature, history, entities, evidence |
| [nutshell-vault/features/tasks-notes/CONTEXT.md](features/tasks-notes/CONTEXT.md) | Planned assignments, deadlines, structured notes, and save conflicts. | planned | feature, tasks, notes, collaboration |
| [nutshell-vault/features/workspace-editor/CONTEXT.md](features/workspace-editor/CONTEXT.md) | Planned workspace shell, Markdown live preview, and graph interaction. | planned | feature, ui, editor, codemirror, graph |
| [nutshell-vault/product/OVERVIEW.md](product/OVERVIEW.md) | Purpose, audience, product loop, and planned alpha scope. | planned | product, purpose, scope, brand |
| [nutshell-vault/runs/ACCEPTANCE.md](runs/ACCEPTANCE.md) | Local setup, application, provider, and source PR verification evidence. | active | verification, acceptance, evidence |
| [nutshell-vault/templates/NOTE.md](templates/NOTE.md) | Required metadata and four-section shape for concise durable notes. | active | template, note, decision |
| [nutshell-vault/templates/TASK.md](templates/TASK.md) | Current-task fields, lead ownership, overwrite rules, and reset semantics. | active | template, task, control |
| [nutshell-vault/workflows/GIT_WORKFLOW.md](workflows/GIT_WORKFLOW.md) | Real source feature PR lifecycle, small commits, and guarded merge cleanup. | active | workflow, git, pull-requests, task-lifecycle |
| [nutshell-vault/workflows/LOCAL_SETUP.md](workflows/LOCAL_SETUP.md) | Local environment and source PR preflight, commands, and operational requirements. | active | workflow, setup, preflight, local-alpha, pull-requests |
| [nutshell-vault/workflows/MEMORY_PROTOCOL.md](workflows/MEMORY_PROTOCOL.md) | Reading order, selective context, note hygiene, supersession, and archive upkeep. | active | workflow, memory, retrieval, task |

## Consequences

Add, rename, supersede, or archive a note together with its row update. Never list archived or inactive notes here, and never omit active files to hit a size target. Default reads and link expansion exclude archive; historical research requires explicit scope. Validation may enumerate paths and metadata without loading all bodies into an agent session.

## Affected files

The table is the complete active managed Markdown scope. Root handoff documents are exempt from the vault note format/length target. Non-Markdown assets and code are referenced by the relevant notes rather than duplicated in this catalog.
