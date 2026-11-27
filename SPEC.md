# Nutshell: first megarun specification

- **Product:** Nutshell
- **Slogan:** Your codebase. In a Nutshell.
- **Specification date:** 26 November 2026
- **Delivery target:** a working, tested alpha built and run locally.
- **State at handoff:** starter instructions and reference assets only.

## 1. Mission and source of truth

Build Nutshell, a web application that helps technical and nontechnical teammates understand and coordinate AI-assisted GitHub projects. Coding agents and developers maintain concise shared repository knowledge alongside code. Nutshell turns that knowledge into a navigable workspace, a product map, and understandable feature history with links to its evidence.

The main loop is: select a repository; understand its purpose and features; open only the relevant memory; make a code or knowledge change; validate it; propose it through Git; inspect its merged impact; coordinate follow-up work with teammates. Nutshell is an interface for understanding a project, not an autonomous hosted coding service.

Implement this specification when the user starts the first megarun. Make routine reversible implementation decisions and continue through tests, repairs, and documentation without milestone approval pauses. Preserve the active user request, existing work, and actual environment permissions.

### Authoritative project references

| Reference | Owns |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent behavior, selective retrieval, small commits, memory upkeep |
| This specification | Product requirements, stack, first-run scope, delivery gates |
| [UI_GUIDE.md](nutshell-vault/design/UI_GUIDE.md) | Exact visual values and interaction contract supplied by the user |
| [BRAND.md](nutshell-vault/design/BRAND.md) | Logo handling, name, slogan, brand usage |
| [SYSTEM.md](nutshell-vault/architecture/SYSTEM.md) | Runtime boundaries, storage ownership, authorization, reliability |
| [GITHUB_CONTRACT.md](nutshell-vault/architecture/GITHUB_CONTRACT.md) | Canonical repository record shapes and provider semantics |
| [Vault index](nutshell-vault/_INDEX.md) | Sole routing catalog of every active managed Markdown file, with descriptions and tags |
| [Current task](nutshell-vault/CURRENT_TASK.md) | One lead-owned current feature brief and its actual PR state |
| [Memory protocol](nutshell-vault/workflows/MEMORY_PROTOCOL.md) | Note hygiene, relevant decisions, archive exclusion, and supersession |
| [Git workflow](nutshell-vault/workflows/GIT_WORKFLOW.md) | Mandatory real feature PRs, small commits, and guarded post-merge cleanup |

After applicable root agent instructions, every agent reads `_INDEX.md` first and `CURRENT_TASK.md` next. Then read the full specification once when planning this first run. For bounded follow-up tasks, consult the relevant requirements and feature context instead of reloading the entire specification and vault. Keep implemented facts and evidence separate from planned requirements.

## 2. Scope of the first megarun

### Required local outcome

Deliver a complete local workflow using real PostgreSQL, database-backed sessions, centralized authorization, durable jobs, parsing, indexing, media access, tasks, notes, and a working browser interface. A small stateful provider simulates the external GitHub lifecycle. The same domain services must serve simulated and live providers.

Implement the real GitHub App adapter and exercise it with controlled API contract tests. Actual product OAuth consent, installation, live webhooks, and customer-repository mutations are a separate acceptance gate unless the necessary disposable resources and exact operations were authorized before the run. Missing live product credentials must not prevent completion of the local application target. Never label simulated tests as live acceptance.

**Build Nutshell using its own revised memory workflow.** Development feature work requires the selected real GitHub source repository, feature branches, small commits, and real PRs. A simulated product PR does not meet this source-development gate. The local runtime remains on the user's machine. One lead coordinates one active feature task and its PR repository-wide; subagents may work concurrently within that feature. See R-06 and R-12.

### Included features

- Branded marketing page with an interactive synthetic editor-and-graph preview.
- Local persona sessions and a real GitHub sign-in integration path.
- Repository selection and a three-zone workspace with tabs, dockable sidebars, and recursive splits.
- Nested Markdown vault browsing, selective retrieval, backlinks, and a source-preserving live-preview editor.
- Server-side Markdown drafts and an authorized branch/PR proposal workflow.
- Product entities with configurable categories, typed relationships, current context, and immutable semantic history.
- Separate Memory Graph and Product Map modes using one graph renderer.
- Native task assignment, date-only deadlines, status, and basic structured team notes.
- Private image upload/delivery and truthful screenshot provenance.
- Repository initialization, validation, source-linked indexing, durable webhook processing, and recoverable failure states.
- Reproducible local setup, fixture scenarios, focused tests, visual review, and a documented handoff.

### Deferred from this run

Hosted agent execution; running arbitrary customer repository code; arbitrary website screenshot capture; deployment; billing; enterprise SSO; public guest repository sharing; GitHub Enterprise Server; fork PR and merge-queue support; full Notion databases/formulas; multiplayer cursors or CRDT editing; GitHub Issues synchronization; embeddings/vector search; cross-repository graphs; comprehensive historical backfill; and a cloud object store. Do not render controls that pretend these features work.

Local development, service startup, dependency installation, scoped fixture generation, source edits, focused verification, branches/worktrees, and small commits are part of the build once the run is requested. Establish the exact source repository and authorized branch-push/PR operations during preflight; perform that feature workflow without repeated milestone permission prompts once authorized. Source and cleanup merges must also satisfy existing authorization and repository policy. Customer-repository writes/merges, new accounts, public deployment, billing, messages, and unrelated repositories require their own existing authorization. Configuration files do not grant runtime privileges.

## 3. Stack and implementation shape

Use compatible stable releases and verify their current installation and API requirements during preflight. Pin the Node runtime, pnpm version, direct dependencies, and lockfile. Record actual versions in the local setup guide; this starter deliberately does not invent a tested version matrix.

| Concern | Default choice | Reason for this project |
| --- | --- | --- |
| Language | TypeScript with strict checking | Shared contracts across web, worker, and CLI |
| Web | Next.js App Router and React | One app for marketing, authenticated UI, and server endpoints |
| Styling | CSS custom properties from the design guide; Tailwind only as useful plumbing | One token system; no default component-library visual theme |
| Accessible primitives | Radix primitives or existing equivalent | Dialogs, menus, focus management; style to Nutshell tokens |
| Icons | Lucide | Required outline icons and stroke widths |
| Package management | pnpm workspaces | Shared local packages without publishing a dependency |
| Persistence | PostgreSQL with Drizzle and versioned migrations | Durable application data and transactional updates |
| Authentication | Better Auth with its official Drizzle adapter | Database sessions and GitHub sign-in; validate actual App token behavior |
| GitHub integration | Octokit with separate user and installation clients | Explicit authority and typed provider access |
| Schema/validation | Zod with exported JSON Schema where useful | One parser contract for the CLI and service |
| Durable jobs | pg-boss and a separate Node worker | Use the existing PostgreSQL service; no Redis requirement |
| Vault source editor | CodeMirror 6 and Markdown syntax support | Decoration-based live preview while preserving Markdown source |
| Team note editor | Tiptap open-source core with a bounded schema | Structured block notes without paid/cloud collaboration features |
| Graphs | React Flow (`@xyflow/react`) plus `d3-force` | Shared graph interactions with force layout |
| Panes | `react-resizable-panels` with a small layout model | Resizable recursive splits and keyboard operation |
| Tests | Vitest and Playwright | Domain/integration checks plus browser journeys and visual evidence |
| Local media | Project-scoped filesystem storage behind authorized server routes | Complete local operation without an external storage account |

These are implementation choices, not evidence that the application exists. Check primary documentation linked in [STACK_SOURCES.md](nutshell-vault/architecture/STACK_SOURCES.md) and [provider sources](nutshell-vault/architecture/SOURCES.md). An API mismatch is a problem to resolve within the chosen boundary, not a reason to silently substitute a different product.

### Minimal source layout to create

| Path | Responsibility |
| --- | --- |
| `apps/web/` | Next.js routes, UI, thin authenticated handlers |
| `apps/worker/` | Durable job execution and reconciliation entry point |
| `packages/core/` | Pure schemas, parsing, link resolution, retrieval, validation, capability decisions |
| `packages/server/` | Database/migrations, sessions, current access checks, providers, jobs, domain services, media |
| `packages/cli/` | Local commands using core plus bounded checkout I/O |
| `tests/fixtures/` | Deterministic synthetic repository/scenario sources |
| `.local/` | Ignored generated fixtures, local assets, and other disposable project state |
| `assets/brand/` | Supplied original brand asset |
| `nutshell-vault/` | This project's durable agent context |

Avoid creating additional packages, service layers, stores, or generic frameworks without an actual shared responsibility. Database and provider modules can remain inside `packages/server`. Keep server code and secrets out of client bundles. Use one authorization policy, one Markdown link resolver, one schema definition, and one graph renderer. Reuse helpers where behavior is truly the same rather than abstracting unrelated operations into a large configuration engine.

## 4. R-01: local execution and reproducibility

Work in the local source checkout. Native Windows is acceptable; document PowerShell-compatible commands. Use an available local PostgreSQL installation or Docker Compose if Docker is available. Docker and WSL are environment options, not mandatory product dependencies. Do not silently switch execution to a hosted environment.

Preflight must inspect existing instructions and uncommitted work; Git and commit identity; Node/pnpm; dependency-download access; database startup/connectivity; browser binaries and dependencies; required write access and ports. Also establish the real source repository/default branch, remote authentication, allowed feature-branch push/PR operations, merge policy, and permitted post-merge cleanup path. Record which remote PR/check rules are actually configured. Missing source PR access blocks starting a feature; finish independent setup/documentation and record the exact blocker. Product GitHub App credentials are a separate integration and are optional for the local product tests.

Resolve allowed setup problems. To finish unattended, the selected source repository's feature and cleanup merges must already be authorized and compatible with its existing review/check policy. Do not weaken a protection or invent reviewer approval. If a mandatory prerequisite cannot be supplied, retain work safely and report the blocked gate; never replace durable services with in-memory mocks or real development PRs with simulated ones to claim completion.

Implement the following root commands, with nonzero exits for failure:

| Command | Required behavior |
| --- | --- |
| `pnpm alpha:setup` | Check prerequisites, create missing development configuration/secrets, migrate the dedicated DB, and seed missing fixtures idempotently |
| `pnpm alpha:dev` | Start web and worker, bind the app to loopback, show URLs and health state, stop child processes cleanly |
| `pnpm alpha:verify` | Use a separate test DB/scenario set; run required focused checks, browser journeys, and optimized-build verification; summarize evidence |
| `pnpm alpha:stop` | Stop only processes/resources started for this project |
| `pnpm alpha:reset` | Explicitly reset only validated generated fixture resources; never reset arbitrary user data |
| `pnpm nutshell --help` | Describe the local CLI and its concrete commands |

Provide a real `.env.example` without secrets and record actual commands in [LOCAL_SETUP.md](nutshell-vault/workflows/LOCAL_SETUP.md). Use Node-based or cross-platform scripts rather than assuming Bash is installed. The commands above are requirements to implement, not commands already supplied by this starter.

### Explicit modes

- `NUTSHELL_MODE=local-alpha|live` selects the provider/identity behavior.
- `NUTSHELL_DEPLOYMENT=local|hosted` describes the intended exposure.
- Local-alpha startup binds to loopback and rejects hosted exposure.
- Live mode fails closed when required configuration is absent. It never silently falls back to synthetic identity.
- An optimized local build may use local-alpha providers. `NODE_ENV=production` alone is not an identity boundary.
- Do not rely on a browser header, role value, or URL flag to enable local identity.

Local mode visibly identifies itself and uses the same session storage, authorization decisions, database, jobs, and UI paths as the live integration. App configuration and trusted server-side providers determine the mode.

## 5. R-02: brand and exact visual contract

Use **Nutshell** and **Your codebase. In a Nutshell.** exactly. Use [the supplied PNG](assets/brand/nutshell-logo.png) as the logo. Preserve its bytes and aspect ratio. The source is 567 by 523 pixels with an opaque light background; it is not a transparent cutout. Use the intentional light logo treatment defined in the brand guide. Do not replace it with an emoji, generated icon, CSS-filtered silhouette, or a redrawn mark.

Follow [UI_GUIDE.md](nutshell-vault/design/UI_GUIDE.md) in full. It contains the user's fifteen design requirements. Its charcoal surfaces, restricted violet accent, hairline borders, tight radii, 40px ribbon, 24px status bar, typography, command palette, and graph behaviors are acceptance criteria. Load [UI_IMPLEMENTATION.md](nutshell-vault/design/UI_IMPLEMENTATION.md) and [UI_ACCEPTANCE.md](nutshell-vault/design/UI_ACCEPTANCE.md) when the task involves their implementation or verification details. Import or faithfully apply the supplied token reference; do not create an alternative theme with approximate colors.

No gradient UI surfaces, glow, heavy shadows, pill-shaped navigation, large rounded dashboard cards, or oversized decorative spacing. Preserve gradients already present in the supplied logo artwork. Distinguish planned features, saved drafts, merge state, sync state, and errors through readable labels as well as visual treatment.

Test keyboard navigation, labels, focus visibility, zoom, and reduced-motion behavior. Respect the guide's explicit contrast notes: do not silently replace default colors or claim a compliance level that was not measured. An optional high-contrast preference must be deliberate and separately verified.

## 6. R-03: marketing and entry routes

Build `/` as a functional marketing entry page. Use the exact slogan as the main headline, with the required 48–64px size, tight tracking, one primary violet CTA, concise muted supporting copy, and the supplied logo. Preserve that size range and allow wrapping at narrow widths as the UI guide specifies. Suggested supporting copy: “Shared project memory, connected features, and clear change history for teams building with AI.”

The single-row translucent navigation can include Product, How it works, and Sign in. Links must reach real sections or routes. The primary CTA opens the local alpha entry flow in local mode and the real sign-in flow in live mode. Do not add invented customer logos, testimonials, usage figures, pricing, or unimplemented buttons.

Show an oversized, edge-cropped interactive preview with a Markdown document and graph. Use a bundled synthetic dataset clearly separated from private repository content. Reuse the real editor/graph components in a bounded preview mode; interactions such as selecting a node or switching the displayed document must work. The preview must not invoke privileged actions or expose local persona endpoints from a hosted deployment.

Required route semantics:

| Route | Behavior |
| --- | --- |
| `/` | Marketing and safe interactive preview |
| `/login` | Mode-appropriate entry; no password system required |
| `/app` | Repositories the current user is currently authorized to access |
| `/app/repos/[repositoryId]` | Workspace with overview, vault, graph, history, tasks, and notes views |
| `/app/repos/[repositoryId]/entities/[entityId]` | Shareable entity deep link opening the same workspace shell |
| `/app/repos/[repositoryId]/settings` | Integration/setup status and permitted configuration |

Use stable identifiers in data access. Mutable owner/repository names are display and routing conveniences, not authorization. An inaccessible repo must not leak its title or data through a deep link, search result, preview, or error.

## 7. R-04: workspace shell and navigation

Create the requested three-zone layout: 40px left icon ribbon; collapsible, resizable, dockable left/right sidebars; central panes with browser-style tabs. The 24px status bar stays at the bottom. Use distinct recessed chrome and the main editor canvas specified by the guide.

Sidebar modules include the repository/vault explorer, properties, backlinks, and contextual history. Provide an actual way to move modules between left and right, through keyboard-accessible commands or menus. A decorative empty right strip is not a dockable sidebar.

Represent central layout as a small recursive split tree with tab groups at leaves. Support split horizontally/vertically, move a tab to another pane, close tabs/panes, and restore layout after reload. Do not arbitrarily stop at two hardcoded panels. Prevent a new split when minimum usable dimensions cannot fit; browser memory and viewport size remain practical limits. Preserve unsaved work when moving panes, changing repositories, or closing tabs.

Keep shared document content independent of per-pane selection and scroll state. Two views of the same draft must not diverge or race their saves. Persist only a versioned, bounded layout preference for the authorized user/repository; do not put private source content in a public cache.

Use the file explorer to show actual nested `nutshell-vault` paths. Distinguish repository documents from database-backed team notes. Offer clear loading, empty, denied, stale, dirty, saving, saved, and conflict states. Status bar metadata must be real and contextual; where a counter does not apply, show a neutral state instead of fabricated values.

The 560px command palette opens with Cmd/Ctrl+P while the application is focused. It searches commands, accessible documents, entities, and views; supports arrow keys, Enter, Escape, and focus return. Intercept the shortcut only in the active application and preserve normal editable behavior. Hidden/inaccessible repositories must not appear in results. Include keyboard commands for panes, sidebar visibility/docking, graph focus, and opening relevant context.

At narrow widths, collapse sidebars into usable drawers and show a focused pane while preserving the desktop layout preference. Prevent page-level horizontal overflow. Make resizing handles and small visual icons operable through suitable hit areas and keyboard controls without changing their required visual dimensions.

## 8. R-05: source-preserving Markdown live preview

Use CodeMirror for vault Markdown. The stored source remains ordinary Markdown, including YAML frontmatter and wikilinks. Render headings, emphasis, inline code, links, lists, and code blocks with editor decorations. Hide formatting tokens away from the cursor line and reveal the raw tokens on the active line, as the UI guide specifies. Never achieve this by rewriting the document every time the cursor moves.

Implement ordinary Markdown links and wikilinks, including a bounded documented subset such as `[[path/to/note]]`, `[[Note|Alias]]`, and heading targets. Use the same resolver for editor links, backlinks, graph edges, and CLI retrieval. Prefer explicit vault-relative paths; resolve bare names deterministically only when unambiguous. Missing or ambiguous destinations get actionable diagnostics, not an arbitrary first match. Do not parse escaped syntax or code-fence examples as real graph links.

Opening a link selects the relevant document/heading in the workspace. Support search, undo/redo, selection, multiline paste, composition/IME input, code fences, and YAML properties without losing source or cursor placement. Source-mode access is available for debugging and precise edits. While composition or a selection makes decoration hiding unsafe, preserve input and selection rather than corrupting content; document the exact behavior.

Authorized writers can create and edit Markdown within the vault. Readers can inspect vault source and use permitted team notes, but cannot propose canonical-source changes. Do not expose rename/delete controls unless their behavior and link consequences are implemented.

### Drafts and Git proposals

Save edits to a server-side draft scoped by user, repository, literal path, base commit/blob, and optimistic revision. A draft is visibly distinct from merged source. Use expected revisions and compare the relevant source blob before save/submission; preserve user text on HTTP 409 conflicts. Never silently overwrite another edit or advance canonical memory just because a draft was saved.

“Propose change” creates or updates an idempotent branch/PR using current user authority. A simulated provider performs equivalent local operations. Existing user branches and customer default branches must be preserved. Only a validated merge updates canonical indexed context. The exact data contract is in [GITHUB_CONTRACT.md](nutshell-vault/architecture/GITHUB_CONTRACT.md).

Treat all repository content and pasted Markdown as untrusted data. Do not execute MDX, scripts, embedded HTML, plugins, or repository commands. Do not fetch remote image URLs automatically. Sanitize supported rendering and restrict navigable URL schemes.

## 9. R-06: persistent memory and selective retrieval

Every assisted repository has a root `nutshell-vault/` directory. This starter's vault is Nutshell's own development memory and must demonstrate the same workflow used by connected repositories. Generated fixture/customer vaults are separate repositories. Git synchronizes committed memory; a teammate's uncommitted files or application database notes do not automatically become shared agent context.

### 9.1. One lightweight routing file

Use **`nutshell-vault/_INDEX.md` as the only active router**. After normal instruction discovery, every lead/delegate reads it first, then `nutshell-vault/CURRENT_TASK.md`, before retrieving task-specific notes. Do not discover context by recursively loading the vault or reading every Markdown body.

The index has one row per active managed Markdown file: repository-relative path, a short description, lifecycle status, and a few meaningful tags. Its fixed table columns are `Path`, `Description`, `Status`, `Tags`; link each path to the actual file. For this workspace, its scope is every Markdown file under `nutshell-vault/` outside `archive/`, plus root `AGENTS.md`, `SPEC.md`, and `README.md`. Include the index itself, CURRENT_TASK, templates, and evidence notes. Do not inventory dependency documentation or unrelated repository files; register any additional out-of-vault documents deliberately adopted as managed context.

Statuses `active`, `planned`, `accepted`, and `draft` can appear in the active catalog; they describe note lifecycle, not proof of implemented code. Exclude archived paths and `superseded`, `deprecated`, or `archived` notes. Require exactly one row per included file, no stale paths, and no duplicates. Do not add per-folder indexes. A validation pass may enumerate paths/metadata to compare the catalog with the tree; that does not justify inserting every note into the model's context.

Aim for fewer than 200 lines and about 12 KiB for the router, with terse descriptions rather than copied document content. **Completeness is mandatory; the size targets are advisory.** Archive obsolete material and shorten descriptions when it grows. Never silently omit active notes, truncate the catalog, or create another routing hierarchy to hide overflow.

### 9.2. One current task, one writer

Use the single tracked **`nutshell-vault/CURRENT_TASK.md`** for the active feature. Every agent always reads it after the index at task start, delegation/handoff, and resumption. The lead rereads it before each mutation. Overwrite its current state rather than appending a session transcript.

For the alpha, only one feature task and its feature PR may be active repository-wide. Delegates can work concurrently on that feature with clear file ownership or worktrees. The lead alone writes CURRENT_TASK and coordinates index changes. Identify the authoritative integration checkout and task revision when delegating; copies in other worktrees are views of the same task and must not generate competing task commits. Do not introduce per-agent task files, a second run checkpoint, or per-feature progress diaries.

Task metadata includes a stable file `id`, `date`, `status: active`, tags, nullable `task_id`, `task_state`, monotonic `task_revision`, actual `repository_id`, `branch`, `base_branch`, `pr_number`, `pr_url`, `lead_agent`, `integration_checkout`, `last_verified_head`, and `cleanup_pr_url`. Allowed task states are `idle`, `in_progress`, `pr_open`, `ready_for_review`, `blocked`, and `cleanup_pending`. File status stays active when the task is idle so the control file remains indexed. Unknown identities are null until observed; never invent a remote or PR.

Use the four standard note sections for objective/scope, current plan and delegated ownership, actual progress/verification/blockers/next action, and affected files. Before overwriting, compare the expected task ID/revision and increment the revision; stale writers must reread. A new task gets a unique task ID. Idle cleanup clears task-specific fields and working text but retains the control file and advances its revision. Do not store the final containing commit's SHA inside that same file; final tested head evidence belongs in PR/check metadata.

Feature work requires a real PR. Keep CURRENT_TASK active through that PR; do not clear it in the last feature commit on the assumption that a merge will happen. After the exact source PR is confirmed merged, preserve durable decisions/evidence, refresh the default branch, and compare repository/PR/task identity plus current task/blob revision. Only a matching completed task may be reset to idle. A closed-unmerged PR, old webhook, local merge, or simulated product merge must not clear it.

Isolated product fixture repositories may simulate this lifecycle for their own fixture task files using explicitly synthetic provider evidence. Those test transitions must never mutate or certify the real development workspace's CURRENT_TASK, source PRs, or cleanup state. The same domain rules run under both providers, with repository identity and evidence class kept explicit.

Persist post-merge cleanup through an already authorized housekeeping writer allowed by current protection, or a tiny cleanup-only PR. The latter does not create a new feature task or trigger recursive cleanup. Recheck task identity/base before merging cleanup; a stale cleanup cannot overwrite newer work. Enforce the expected blob/base at the actual write or protected merge boundary, not just a preceding client-side read. If the available write/merge path cannot reject a stale state, report cleanup blocked instead of using an unguarded update. The local idle file is not proof of canonical cleanup. Report pending cleanup in PR metadata/current remote state, and do not start the next feature until the canonical reset is confirmed. Full recovery and merge rules are in [GIT_WORKFLOW.md](nutshell-vault/workflows/GIT_WORKFLOW.md).

### 9.3. Relevant decisions and excluded archive

Organize current subsystem knowledge under `features/<feature>/CONTEXT.md` and focused architecture/design/workflow notes. Store finalized choices in **`nutshell-vault/decisions/YYYY-MM-DD-topic.md`** with `status: accepted`, subsystem tags, and a stable `decision_key`. Allow at most one current accepted note per key. Load a decision only when its subsystem, affected files, or dependency is relevant; never load the whole decisions directory by default. Tentative choices remain in current context until finalized.

Store deprecated features, obsolete plans, and superseded notes in **`nutshell-vault/archive/`**, with original identity/date, explicit historical status, and provenance. Default retrieval, automatic wikilink expansion, current-context ranking, and the default Memory Graph exclude that folder and inactive statuses. A link from an active note does not opt the archive back in. Historical retrieval requires an explicit request/flag and must label returned content as historical; then search the bounded archive directly, without adding it to the active index.

Do not create an append-only `HISTORY.md` for every feature. Durable reasoning belongs in accepted decisions; current understanding belongs in feature context; former notes belong in the archive. The product's immutable `.nutshell/changes/` events and Git/PR history remain the evidence of change. Current entity memory links must resolve to active notes. Previously accepted event links resolve at their original immutable accepted revision, so moving a note later does not rewrite or invalidate historical payloads.

### 9.4. Strict note hygiene and supersession

Every active durable vault Markdown file, including control files and templates, has required frontmatter and exactly four second-level headings in this order. Subheadings may divide a section. A title is optional. Example note shape:

```markdown
---
id: unique-stable-note-id
date: "2026-11-26"
status: active
tags: [subsystem, topic]
---
## Context
The relevant problem, current facts, and source evidence.

## Decision
The current conclusion or chosen behavior.

## Consequences
Tradeoffs, observed verification, limitations, and follow-up.

## Affected files
Concrete source, test, requirement, or note paths and their relevance.
```

Target fewer than 200 lines per note. Split a long note into focused documents when useful and index each one; do not create filler files merely to hit a count. A necessary exception needs `length_exception_reason` metadata. Root `SPEC.md`, `AGENTS.md`, and `README.md` are full handoff/control references and are exempt from that note format/length target. Archived original content may retain its historical structure beneath explicit lifecycle/provenance metadata.

When a decision changes, perform one cohesive supersession update: create the new accepted dated note; mark the old note `superseded`; set its repository-relative `superseded_by` to the replacement; move it to archive; optionally add a `supersedes` backlink; remove the old row and add the new row in `_INDEX.md`; update current guidance, links, and entity references. Preserve historical event references at their original revision. A validator rejects duplicate active decision keys, dangling replacement links, and inactive files in the active catalog; the agent must also check prose for contradictions, which key uniqueness alone cannot detect.

Do not store secrets, raw conversation transcripts, full command logs, or private reasoning. Record short conclusions, facts, source paths, verification, and uncertainty. A note's accepted status is a finalized choice, not a fabricated human review or passing test. Follow [MEMORY_PROTOCOL.md](nutshell-vault/workflows/MEMORY_PROTOCOL.md) and [NOTE.md](nutshell-vault/templates/NOTE.md).

### 9.5. Retrieval, CLI, and enforceable checks

Implement deterministic local CLI commands with readable and JSON output, using shared core parsing and validation:

| Command | Contract |
| --- | --- |
| `pnpm nutshell init` | Preview/create `_INDEX.md`, idle `CURRENT_TASK.md`, decisions/archive directories, templates, minimal structured records, and a managed AGENTS section; preserve owner content; idempotent |
| `pnpm nutshell context --query <text> --paths <paths> --budget <limit>` | Read the two control files, rank index rows by task/path/description/tags, then return only relevant bounded file sections with paths, headings, revision, reasons, and budget information |
| `pnpm nutshell context ... --include-archive` | Explicit historical investigation only; return bounded historical results with lifecycle/replacement labels, kept distinct from current guidance |
| `pnpm nutshell impact --base <ref> --head <ref>` | Map changed paths to registered entities, relevant context/decision notes, and uncovered changes |
| `pnpm nutshell validate --base <ref> --head <ref>` | Check bounded tree/records, complete active index, metadata/headings/length policy, task lifecycle changes, supersession, links, coverage, and meaningful change declarations |
| `pnpm nutshell change add` | Create one small semantic change record; noninteractive flags support agent use |

Support explicit `--ref` and `--working-tree` retrieval modes, rejecting contradictory combinations. Default revision reads must not mix a branch with latest-main memory. Always return the index and current task as mandatory control context; if the requested budget cannot hold them, return a clear budget error instead of silently omitting or truncating them. Rank optional context using index path/filename/description/tag matches, then lexical matching within selected candidates and bounded relevant link expansion. Report no-match/gaps and permit deliberate query expansion rather than loading everything. Token budgets are estimates unless the actual tokenizer is used. Embeddings/vector search are deferred; this retrieval protocol must work locally without them.

Bound file size, total input, path depth, parser work, search, link expansion, and returned context. Reject traversal and symlink escapes. Validation and background product indexing may parse an authorized snapshot for their own work; agents still receive only relevant context. A stale or incomplete index is a surfaced validation error, not a reason to silently rebuild context by reading the entire vault.

Implement trusted CI/required-check integration for index completeness, note hygiene, valid supersession, PR/task association, and guarded cleanup. Provider evidence is necessary for merge claims; an offline validator can report that evidence unavailable but cannot certify a merge. Validate feature PRs with active task state and permit idle resets only through the verified cleanup path. Include meaningful positive and negative fixtures for these rules. Establish these controls in the first implementation slices so the rest of the build demonstrates them.

`AGENTS.md` specifies behavior and preserves owner-authored rules; it is not an immutable security boundary. Detect applicable nested/override files and surface instruction-discovery diagnostics. Actual GitHub PR/check protection must be configured and applicable before reporting it enforced; a local validator or Markdown rule does not install remote policy. Use trusted checks that a proposing change cannot weaken to approve itself. Never claim every agent or repository owner can be compelled by a file.

## 10. R-07: product map, memory graph, and history

Use the small structured format in [GITHUB_CONTRACT.md](nutshell-vault/architecture/GITHUB_CONTRACT.md): `.nutshell/config.json`, entity records, and change records. Shared explanations remain in Markdown and are linked from records. Do not duplicate the whole vault into JSON or create a separate Nutshell folder beside each source file.

Default entity kinds are feature, screen, service, and module. Permit registered custom display kinds such as level, plus grouping, without changing authorization or executing type-specific code. A stable entity ID survives renames. Relationships are explicit claims with typed targets; do not present them as a fully verified static dependency analysis.

An entity view contains a plain-language summary, lifecycle, source paths, relevant memory, dependencies/relationships, recent changes, linked tasks, and evidence. Technical details can be expanded without making nontechnical teammates read raw commits first. Show current source revision and freshness.

### Two graph modes, one renderer

- **Memory Graph:** actual resolved Markdown/wikilink relationships in the authorized vault snapshot.
- **Product Map:** declared product entities and typed relationships from validated structured records.

Use the guide's circular nodes, 1px edges, violet hover/focus highlight, 20% opacity for unrelated nodes, and smooth force-based positioning/pan/zoom. Provide selection, centering, filtering, and a list alternative. Keyboard focus must expose the same useful detail as hover. A drag changes presentation, not a canonical relationship. Bound the rendered neighborhood and offer expansion/search for large graphs. Pause unnecessary simulation and honor reduced motion.

### Semantic history

Group change history by entity/kind with source links, plain-language impact, technical explanation, and evidence state. Keep PR proposals distinct from validated default-branch changes. “Merged” must never be displayed as “deployed”; deployment remains unknown until a future trusted deployment source exists.

One change record represents one semantic event. Preserve accepted payloads and first introduction revisions; identical records across subsequent snapshots do not create duplicates. Renames and removals retain historical identity. Correct or reverse an accepted event with a new linked event; do not rewrite history invisibly. No file needs to contain the SHA of the commit that contains that same file.

Agent-authored explanations are declarations. Keep declared, inferred, observed, agent-reviewed, human-reviewed, and stale evidence distinct. Test fixtures are visibly synthetic. Schema validity alone does not establish truth, correctness, or human review.

## 11. R-08: accounts, access, and GitHub integration

Use Better Auth database sessions and its GitHub provider with a GitHub App configuration. Configure trusted origins, state/PKCE behavior, secure deployed cookies, and encrypted OAuth token storage through supported APIs. Validate the chosen version's actual App token expiry/refresh behavior; an encrypted server token-lifecycle service may be needed. Do not rely on generic OAuth-App assumptions for GitHub App user tokens.

Local synthetic personas enter through a server-controlled local identity adapter using the same session model. A browser-supplied role, repository ID, or header cannot create authority. Do not add password login or a separate insecure demo authentication system.

### Required access policy

Every protected page, handler, Server Action, search, export, draft, task, note, and asset request uses the same server authorization layer near data access. Require a valid session, active repository membership, an active installation including that repo, and sufficient current provider access. In local mode, the provider supplies equivalent synthetic grants. For the alpha, reuse access results only within a request; provider errors fail closed with a useful state.

Use stable GitHub IDs. Show actual verified roles/capabilities rather than inventing a two-role Owner/Contributor hierarchy. An organization can own a repository; installing Nutshell does not make a person its permanent owner. Local membership may narrow GitHub access, never expand it.

| Action | Required authority |
| --- | --- |
| View project knowledge, tasks, and notes | Current repository read access plus active local association |
| Create own team note/task | Same read access, with server-owned creator identity |
| Edit/delete own note or own task details | Creator authority; coordinators may manage repository collaboration records |
| Update assigned task status | Assignee, creator, or coordinator authority |
| Assign another member or manage others' records | Verified write/maintain/admin-equivalent capability under Nutshell policy |
| Draft/propose repository Markdown changes | Current code-write capability and user-authorized provider client |
| Configure repository integration | Verified repository administration authority |

Assignees must already be active authorized members of the same repository workspace. Assignment must not invite users, grant GitHub access, or send messages. Unknown/custom roles require verified capabilities or conservative denial.

### GitHub App and setup

Use the minimum permissions documented in the contract: Metadata read, Contents write, Pull requests write, Checks write, and Account Email addresses read for the selected sign-in configuration. Do not add unrelated provider permissions. Keep installation reads/checks separate from user-requested writes. Never retry a denied user operation with installation credentials.

Onboarding verifies the installation/repository association and configuration authority, reads existing instructions/default-branch files, and opens one idempotent setup PR. Preserve user files and instructions. Show awaiting-merge; do not silently write or merge into a customer's default branch. Live test merges require prior explicit authorization for the exact disposable repository.

Handle session expiry, token refresh failure, user deauthorization, access removal, installation suspension/removal, repository selection changes, transfer, and deletion. A repository transfer must not automatically transfer private tasks/notes to a different audience. See the connection-epoch and re-association rules in the system reference.

## 12. R-09: durable synchronization, validation, and media

The web app receives provider events; a dedicated worker does bounded parsing/validation/indexing. Verify raw-body HMAC, persist a unique receipt and enqueue work atomically (or use a transactional outbox), then acknowledge. Do not perform a full repository ingest inline before durable acceptance.

Fetch all inputs from one immutable revision. Use service-owned validators and trusted policy; a PR cannot weaken its own gate by changing config, covered paths, exclusions, or validator files. Post Checks against the exact PR head in the live adapter, and record equivalent synthetic checks locally. Validate the actual merged tree again before publication.

Write complete snapshots transactionally. Use current-ref checks, serialization/compare-and-swap, and a connection epoch so delayed jobs cannot regress current state or restore removed access. Deduplicate delivery receipts and semantic events independently. Add bounded retries/backoff, failed-job visibility, and reconciliation. A worker restart must recover durably accepted work.

If a new snapshot is invalid, preserve the last valid snapshot with its source revision, age, and an explicit failure state. Current authorization still governs old data. Show validation-enabled separately from merge-enforcement-enabled. Unsupported fork/merge-queue flows must not falsely pass.

### Media and screenshots

Provide a bounded authenticated raster upload endpoint for current writers and a server-owned asset record containing repository ownership, MIME type, size, byte digest, storage locator, and provenance. Store bytes outside the public web directory in the local media store. Validate file type/size/dimensions, restrict formats, and avoid executable SVG/HTML uploads.

Serve private images through an authorized proxy with private/no-store behavior. An asset ID or raw storage key is not permission. Declare missing/deleted evidence visibly; do not show a broken image as proof. Git records refer to asset IDs and descriptive capture metadata; no signed URLs or screenshot binaries need to be committed.

Only controlled screenshots of this app's local test fixtures may be captured automatically in the first run. An uploaded source SHA or timestamp is a declaration until tied to trusted capture evidence. A successful synthetic capture is fixture evidence, not a human review or production deployment. Never build a general URL-fetching screenshot service or run customer code to obtain images.

## 13. R-10: tasks and team notes

Store collaboration records in PostgreSQL, scoped to a repository workspace. They are not automatically committed memory. Give users a copyable, source-linked task brief they can pass to their coding agent. Do not pretend external agents automatically receive database notes.

A task has an ID, title, optional description, one assignee, creator, status, optional date-only due date, linked entity IDs, optional same-repository GitHub issue/PR references, and an optimistic revision. Use a SQL date and a `YYYY-MM-DD` API value for deadlines; do not turn a date-only deadline into an accidental UTC timestamp. Make any overdue display timezone explicit. Statuses are todo, in_progress, blocked, and done.

Provide a useful list with status/assignee/due filters and a detail editor. “Blocked” requires a reason. Assignment and due-date controls must persist and update the visible list. GitHub links are links, not synchronization promises. Do not send notifications or email during this local run.

Use Tiptap only for basic database-backed team notes: paragraphs, headings, ordered/unordered lists, checklists, code blocks, and safe links. Store a bounded versioned JSON schema and validate server-side. Use the same Nutshell typography/tokens and keyboard-first controls. A compact slash menu or contextual menu is acceptable; avoid a large formatting toolbar. Preserve the distinction from CodeMirror's plain-text repository documents.

Save notes/tasks with expected revisions. Concurrent stale writes return HTTP 409 and preserve the user's attempted content with a usable reconciliation view. A draft save indicator must correspond to actual persistence. Do not implement CRDTs, realtime cursors, arbitrary embeds, formulas, or full Notion databases in this alpha.

## 14. R-11: security and correctness constraints

These requirements protect actual boundaries used by this product; they are not a separate compliance program.

- Centralize authorization and enforce repository/workspace predicates in data access. Validate all client-supplied IDs and optimistic revisions.
- Prevent cross-repository access through deep links, search, media, drafts, tasks, notes, and export routes. Private responses must not enter a shared/public cache.
- Keep private keys, provider tokens, and session secrets out of client bundles, logs, commits, and the memory vault. Do not copy connected repositories' private source or raw private webhook payloads into Nutshell's public output, logs, committed fixtures, or unnecessary memory notes. Commit the intended application code and project documentation normally.
- Validate raw HMAC bytes, event schemas/actions, and supported API responses. Log useful operation IDs and failure classes without leaking credentials.
- Treat Markdown, JSON, repository files, and collaborator notes as untrusted input. Apply size/depth bounds; reject path traversal/symlink escapes; sanitize rendered content; do not execute repository code.
- Use one server-side token authority decision. Installation authority is never a fallback for failed user authority.
- Test connection removal and stale background work. Revocation must prevent later protected responses; previously downloaded bytes cannot be recalled.
- Use trusted policy for PR checks and revalidate merges. A valid schema is not proof of semantic truth.
- Keep local identity guarded by explicit mode/exposure configuration and the normal session/authz path. Do not ship a hidden universal demo login.
- Preserve user changes and existing hooks. Do not change tests merely to match broken behavior or bypass a denied operation.

## 15. R-12: memory upkeep, commits, and autonomous work

Apply [AGENTS.md](AGENTS.md), R-06, and the [Git workflow](nutshell-vault/workflows/GIT_WORKFLOW.md) while building Nutshell itself. Source feature PRs are mandatory. Establish the selected real source remote and authorized operations before starting a feature; use a feature branch, push its first coherent commit, and open a real draft PR early. A product fixture PR is not source-development evidence. Do not write feature commits directly to the default branch or batch the entire app into one PR.

Commit after small coherent implementation slices, with relevant verification, memory, and index updates. A migration plus its consumer and focused test can be one slice. Do not accumulate an entire milestone or the entire app into one commit; do not split a coherent change into broken intermediate commits merely to increase the count. Keep each feature PR small enough to describe and verify independently.

Stage explicit paths/hunks and inspect the staged diff. Leave unrelated changes untouched. Preserve hooks. Never create empty commits or invent a Git author identity. If commit authority/identity is unavailable, record that preflight blocker and retain work safely rather than claiming commits were made.

Use one lead agent for the single feature task, contracts, migration order, integration, and acceptance. Parallel delegates work within that feature with bounded ownership or worktrees and return evidence. The lead alone overwrites CURRENT_TASK after checking its task identity/revision, and coordinates shared index edits. They may not race shared schema, lockfile, or task edits. Worktree copies must not become independent task ledgers. Fix integration conflicts rather than asking the user to coordinate routine work. This alpha coordination rule is not a general distributed lock for unrelated teams or independent features.

Overwrite CURRENT_TASK at meaningful boundaries: starting a feature, handing work to delegates, completing a useful slice, observing a PR/check transition, encountering a blocker, and preparing a handoff. Maintain concise current feature context and relevant accepted decisions using the required four-section template. Archive obsolete guidance and remove it from the active index. The acceptance ledger holds observed verification; it is not another current-task file. Do not fill memory with every tool output, and do not put a commit's final SHA in a file that is part of that same commit.

Keep the task active while its feature PR is open. Respect existing review/check rules and merge only under established authorization. Confirm the exact remote PR actually merged before clearing the task, then persist the matching idle reset through the guarded cleanup path. A pending cleanup blocks the next feature. Cleanup-only PRs are not feature tasks and must not trigger an endless cleanup loop. Closed-unmerged PRs remain unresolved; old merges must never clear newer work.

After repeated identical infrastructure failures, diagnose and try a materially different permitted remedy. Continue independent authorized work; do not loop unchanged indefinitely. If source access fails mid-feature, retain the same task/branch and record the blocked PR gate; do not claim completion or start another feature. On resume, read the index then CURRENT_TASK and reconcile them with Git, remote PR/cleanup state, and actual services. A saved task brief enables resumption but does not automatically restart a stopped process.

## 16. Build sequence and small delivery slices

Milestones organize the work; they are not human approval gates. Deliver each milestone through small feature PRs with multiple coherent commits as appropriate. Complete one feature's verified merge and cleanup before starting the next; delegates may work concurrently within the current feature.

| Milestone | Work and exit condition |
| --- | --- |
| M0: prepare | Preflight local tools and real source PR/merge-cleanup access, inspect existing work, verify active index and idle task, plan the first small feature PR |
| M1: contracts and design foundation | Pin tooling and initialize minimal source layout; implement/test memory validator and trusted PR/cleanup checks early; shared schemas/link resolver, repository format, CLI fixtures, exact CSS tokens and unchanged logo |
| M2: trustworthy local vertical slice | Migrations, sessions, central access checks, stateful provider, setup PR simulation, signed event ingress, durable worker, validated snapshot |
| M3: usable workspace | Actual repository explorer, tabs/splits/docking, CodeMirror live preview, backlinks, product details, graph modes, history connected to real local data |
| M4: edits and collaboration | Markdown drafts/proposals/conflicts, tasks/assignees/deadlines, Tiptap notes, private media, real GitHub adapter and controlled contracts |
| M5: entry and visual finish | Interactive marketing preview, entry flow, responsive layouts, keyboard/palette/reduced-motion behavior, exact visual inspection |
| M6: verification and handoff | Adversarial scenarios, restart/reconciliation, optimized build, clean setup walkthrough, fixes, recorded evidence and live-release checklist |

Useful slice examples: “validate entity paths”; “preserve draft on conflict”; “add keyboard split command”; “deny cross-repo media”; “index one signed merge event.” Tests and affected vault context belong with their slice.

## 17. Acceptance matrix

The coding run must record exact commands/actions, observed results, and source revisions in [ACCEPTANCE.md](nutshell-vault/runs/ACCEPTANCE.md). This table defines the gates; all application gates start as not run. Use focused tests that exercise meaningful behavior rather than tests that simply mirror constants or add a coverage percentage.

| ID | Required evidence |
| --- | --- |
| A01 | Clean documented local setup; repeated setup is idempotent; web and worker start; generated state survives appropriate restarts |
| A02 | Lint, strict typecheck, focused unit/integration tests, and optimized build pass with exact commands recorded |
| A03 | Separate test DB/reset guards cannot target the interactive alpha DB or unrelated resources |
| A04 | Real database sessions and server-controlled personas; unauthenticated and wrong-repo requests are denied across all protected surfaces |
| A05 | Removal/revocation/transfer and delayed jobs cannot restore access or reveal cached private content; failed user tokens never use installation fallback |
| A06 | Parser rejects incompatible schemas, duplicate IDs, unsafe paths, excessive inputs, invalid references, and invalid hierarchy cycles without executing code |
| A07 | Retrieval reads index then current task, respects revision/working-tree selection and budget, returns relevant paths/reasons, and reports missing control budget or ambiguity explicitly |
| A08 | Covered unmapped changes are diagnosed; a PR cannot weaken its own validation policy |
| A09 | Invalid HMAC is rejected; valid duplicate deliveries are idempotent; restart resumes durable jobs; out-of-order jobs cannot regress snapshots |
| A10 | Repeated onboarding preserves owner instructions and produces/fetches one setup PR; a simulated merge exercises the real ingestion path |
| A11 | Invalid new source preserves a clearly labeled last valid snapshot; accepted events survive renames/removals/corrections and archived-note moves with original-revision links and no duplicate history |
| A12 | Logo/name/slogan match the supplied brand; computed styles and visual inspection match all fifteen UI guide requirements |
| A13 | 40px ribbon, 24px status bar, dockable/collapsible sidebars, repeated recursive splits, tab movement, layout restoration, and usable narrow layout |
| A14 | Markdown tokens reveal on the cursor line; undo, selection, multiline paste, IME, YAML, code fences, and wikilinks preserve source bytes/meaning |
| A15 | Two panes share a draft correctly; authorized save/proposal works; stale draft/source returns conflict without lost text; readers cannot propose code changes |
| A16 | Memory Graph and Product Map use the correct sources; hover/focus/dimming/pan/zoom and list alternative work; user layout changes do not mutate relationships |
| A17 | Cmd/Ctrl+P palette opens/closes/focus-restores, filters actual commands and accessible content, and performs its selected actions |
| A18 | Tasks persist assignment, status, and date-only deadline; assignee eligibility and all creator/coordinator rules are enforced server-side |
| A19 | Structured notes persist; a second session produces a genuine optimistic-save conflict; unsupported blocks/unsafe links are rejected |
| A20 | Private media requires current repo access; oversized/invalid uploads are rejected; missing or merely declared evidence is labeled honestly |
| A21 | Marketing preview is interactive and uses synthetic data; navigation and CTA routes work; private repo content is absent from public output |
| A22 | Live mode with missing settings fails closed; local identity/providers cannot run as hosted mode; an optimized local-alpha build still works |
| A23 | Real GitHub adapter contract tests cover pagination/errors, token expiry/refresh, authority separation, setup/check targeting, and configuration |
| A24 | Complete browser journey: sign in locally, select repo, inspect feature/memory/graph/history, edit/propose/merge, observe refreshed context, assign task, save note, switch persona and verify denial |
| A25 | Memory reflects actual implementation; coherent small commits and real source feature PRs have traceable evidence; handoff distinguishes completed, failed, blocked, and unrun work |
| A26 | Active index coverage is exact: missing/duplicate/stale/inactive rows fail; control/template files are included; no additional active router exists; body reads are limited to routed candidates |
| A27 | One lead-owned task is read before work, overwritten with current state, and guarded by task identity/revision; stale writes and competing task ledgers are rejected; delegates use the same feature brief |
| A28 | Only relevant accepted decisions load; duplicate current decision keys fail; replacement marks/archives the old note, resolves supersession links, and updates active index/references |
| A29 | Active vault notes have required metadata and exactly four main headings; notes below 200 lines pass; longer notes need a reason; root handoff documents and preserved archived originals follow their stated exceptions |
| A30 | Archive/inactive notes stay absent from default retrieval, link expansion, and default graph even when linked; explicit historical retrieval returns bounded, clearly labeled evidence |
| A31 | Real source PR evidence is distinct from fixtures; pre-merge/closed-unmerged resets fail; matching confirmed merges permit guarded cleanup; stale/duplicate merges and stale cleanup cannot erase newer tasks; cleanup does not recurse |

Visual/browser evidence should include the guide's viewport set: 1440×900, 1280×800, 1024×768, 768×1024, 390×844, and 320×740, plus a zoom/keyboard pass. These are proposed test viewports, not claimed screenshots. Use deterministic fixtures and settle/freeze graph layout for repeatable captures. Inspect actual screenshots against the guide; a newly recorded screenshot baseline alone does not prove fidelity.

Use at least two repository fixtures and three synthetic personas: a coordinator, a reader, and a user limited to the other repository. Include active/planned/removed entities, an entity rename, correction/reversal, a draft, a malformed revision, a stale snapshot, a missing asset, and permission-revocation scenarios. Generate actual different immutable source trees between revisions. Clearly label all fixture identities/events.

### Live product acceptance is a separate evidence class

Actual product GitHub OAuth, installation consent, adapter-driven PR/check behavior, live event delivery, and real permission revocation remain unverified unless exercised against preauthorized disposable resources. Contract tests do not establish these results. Record them as not run with exact setup steps when unavailable; do not turn them into fake green rows or let them block the complete local application milestone. Real source-development PRs remain mandatory and are recorded separately; a source PR alone does not prove the app's live GitHub adapter works.

## 18. Final deliverables and stopping condition

Deliver application source, migrations, fixtures, schemas, a pinned lockfile/toolchain, environment example, root command suite, local operational instructions, and the updated vault. Include the exhaustive active index, single task file, concise templates/decisions, excluded archive, memory validator, and PR/cleanup integration evidence. Include a small operations section for failed jobs, reconciliation, retention, backup/restore, and future live setup. Do not deploy the application as part of this local run.

The final report must state:

1. What works and the exact commands/URL to run it locally.
2. Tests actually performed, with local, simulated-provider, and live evidence separated.
3. Screenshots/observations for the required visual and responsive checks.
4. Material implementation decisions or deviations, linked to vault decisions.
5. Any failed, blocked, or unrun required gate and the next executable step.
6. Remaining one-time GitHub setup and live-release verification.
7. Actual source feature PRs, configured merge gates, and canonical CURRENT_TASK cleanup state; name any gate that remains blocked or merely specified.

Finish when local acceptance gates pass, source feature PR/cleanup requirements are satisfied, and the handoff is reproducible, or when an unavoidable environment/authorization blocker remains after all independent authorized work is complete. A working local app with a blocked real PR or pending canonical cleanup must be reported with that unresolved gate. Do not stop at a static mockup, a plan, or a successful scaffold command. Do not claim a finished public SaaS or live product-provider acceptance from a local alpha.
