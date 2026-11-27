---
id: architecture-stack-sources
date: 2026-11-26
status: active
tags: [architecture, sources, stack, runtime]
---
# Stack reference sources

## Context

Reviewed for this handoff on 26 November 2026. These are primary documentation sources supporting the selected components, not a verified compatibility matrix. Pin compatible stable versions and inspect the actual installed APIs during implementation. Requirements and behavior belong to [SPEC.md](../../SPEC.md); provider details belong to [SOURCES.md](SOURCES.md).

## Decision

| Component | Primary reference | What to verify during the run |
| --- | --- | --- |
| Next.js | [Installation](https://nextjs.org/docs/app/getting-started/installation) | Current Node/React requirements, scripts, App Router setup |
| Better Auth GitHub | [GitHub provider](https://better-auth.com/docs/authentication/github) | GitHub App email permission, callback, provider behavior |
| Better Auth sessions/storage | [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) and [OAuth](https://better-auth.com/docs/concepts/oauth) | Current adapter package/API, session schema, encrypted tokens, App refresh handling |
| pg-boss | [Maintainer README](https://github.com/timgit/pg-boss) and [ORM adapters](https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md) | Supported Node/PostgreSQL versions and transactional receipt/job pattern |
| CodeMirror | [Official decoration example source](https://github.com/codemirror/website/blob/main/site/examples/decoration/index.md) and [reference](https://codemirror.net/docs/ref/) | Use view decorations and parser state; preserve source/selection/IME |
| Tiptap | [Editor overview](https://tiptap.dev/docs/editor/getting-started/overview) | Use open-source headless core and an explicit bounded schema; exclude paid/cloud features |
| React Flow | [Layout overview](https://reactflow.dev/learn/layouting/layouting) | Graph interactions and an explicit force-layout integration; layout is not automatic semantic analysis |
| Resizable panes | [Maintainer repository](https://github.com/bvaughn/react-resizable-panels) | Current component API, sizing, persistence, accessibility |

Additional implementation references: [pnpm workspaces](https://pnpm.io/workspaces), [Drizzle transactions](https://orm.drizzle.team/docs/transactions), [Playwright screenshots](https://playwright.dev/docs/test-snapshots), and [Lucide React](https://lucide.dev/guide/packages/lucide-react). Resolve concrete API/version questions against their current official docs rather than copying obsolete examples.

For local Codex setup, see the [official Windows guide](https://learn.chatgpt.com/docs/windows/windows-app) and [permission modes](https://learn.chatgpt.com/docs/permission-modes). Choosing a model/effort and client permissions is environment setup; project prose does not select or elevate them.

## Consequences

Consult the rows relevant to the current subsystem instead of loading all documentation for each task. Record actual pinned versions and verified setup in the setup note, not a competing run log. Finalize a meaningful stack decision in top-level `nutshell-vault/decisions/YYYY-MM-DD-topic.md` with subsystem tags and a stable `decision_key`; supersede conflicting guidance and update the active-only `_INDEX.md`.

These references do not justify expanding the alpha into extra packages, cloud accounts, services, or permissions. Local product fixtures and real development PR requirements remain separate.

## Affected files

- Root package/toolchain manifests and lockfile when created; the minimal web, worker, core, server and CLI packages.
- `nutshell-vault/workflows/LOCAL_SETUP.md` for observed setup, and relevant top-level dated `nutshell-vault/decisions/` notes.
- `nutshell-vault/_INDEX.md` for this reference's metadata and supersession status.
