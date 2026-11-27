---
id: archived-root-vault-index
date: "2026-11-26"
status: superseded
tags: [archive, memory, routing]
original_path: nutshell-vault/INDEX.md
archived_on: "2026-11-26"
superseded_by: nutshell-vault/_INDEX.md
---
# Archived root vault index

> Historical source preserved during the revised memory-workflow migration. This is not an active router. Relative links and instructions below describe the former layout and must not be followed as current guidance. Use the replacement named in superseded_by.

# Nutshell memory vault

Status: planning scaffold. No application implementation or passing verification is implied by these files.

At first-megarun planning, read the full [SPEC.md](../SPEC.md) once. For later bounded tasks, use relevant specification sections and the smallest useful route below. On resumption, also reconcile [CURRENT.md](runs/CURRENT.md) with actual files and Git state. This vault stores durable context alongside the specification, source code, and verification evidence.

| Task | Read next |
| --- | --- |
| Understand the product | [Product overview](product/OVERVIEW.md) |
| Work on a feature | [Feature index](features/INDEX.md), then its `CONTEXT.md` |
| Build or change the UI | [UI guide](design/UI_GUIDE.md) |
| Prepare local execution | [Local setup](workflows/LOCAL_SETUP.md) |
| Change architecture | [System](architecture/SYSTEM.md) |
| Change GitHub integration | [GitHub contract](architecture/GITHUB_CONTRACT.md) |
| Maintain context | [Memory protocol](workflows/MEMORY_PROTOCOL.md) |
| Stage and commit work | [Git workflow](workflows/GIT_WORKFLOW.md) |
| Resume a run | [Current state](runs/CURRENT.md), then relevant [acceptance checks](runs/ACCEPTANCE.md) |
| Understand the local-first decision | [Decision 0001](decisions/0001-local-execution.md) |

Read feature history only for a question about past changes. Create history when there is something meaningful to record; none is needed to imply progress during planning. Use [templates](templates/INDEX.md) for consistent short notes. Do not recursively read every linked document.
