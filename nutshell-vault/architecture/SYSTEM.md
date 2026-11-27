---
id: architecture-system
date: 2026-11-26
status: active
tags: [architecture, runtime, storage, authorization]
---
# Nutshell system architecture

## Context

This is the implementation handoff for the local alpha. The root `SPEC.md` owns product scope and acceptance; [GITHUB_CONTRACT.md](GITHUB_CONTRACT.md) owns the repository format and GitHub boundary. The choices here are design decisions, not claims that the application already exists.

## Decision

### Product and execution boundary

Nutshell helps teammates understand a GitHub project through shared agent memory, a product graph, meaningful change history, screenshots with provenance, and lightweight tasks and notes. Agents maintain knowledge with their code changes. The website reads and explains that knowledge; it does not operate a hosted coding-agent fleet.

Build real PostgreSQL persistence, sessions, centralized authorization, durable jobs, parsing, projections, and application behavior. A stateful local provider simulates only the external GitHub boundary so development can finish without account creation, OAuth consent, or a human merging a fixture PR. Implement the real GitHub adapter as well. Controlled adapter tests do not establish live-provider acceptance. Required media uses a scoped local asset store behind authorization; an S3 adapter is a later release option, not a prerequisite.

Use one TypeScript pnpm workspace with `apps/web`, `apps/worker`, `packages/core`, `packages/server`, and `packages/cli`; do not create extra empty packages. The Next.js web process handles requests; a long-running Node worker handles jobs. Core owns pure schemas, parsing, authorization decisions, retrieval, and projection rules. Server owns database/migrations, sessions, current-access checks, GitHub providers, jobs, media and application services. CLI combines core with bounded checkout I/O. The provider supplies external facts and operations, not alternative domain logic.

Use Drizzle with PostgreSQL, pg-boss with a supported transactional adapter or a transactional outbox, and Zod with exported JSON Schema. Use Better Auth and its official Drizzle adapter for persisted sessions. Keep GitHub user-token refresh/encryption in a small separate service if the installed provider does not correctly cover GitHub App semantics. Pin a compatible stable dependency set during preflight. Do not handwrite a parallel session system.

CodeMirror edits vault source; Tiptap supplies structured team notes; one graph renderer serves the graph views. These are client concerns, not new sources of architectural truth. No Redis, vector database, graph database, or realtime editing service is needed for this alpha.

### One registry and one current task per vault

This starter's `nutshell-vault/` is the development team's memory **about building Nutshell**. `_INDEX.md` exhaustively inventories active managed Markdown, including root AGENTS/SPEC/README control references, and never archived entries. Read `_INDEX.md` first, then the single `CURRENT_TASK.md`, then task-relevant notes. Do not add per-folder indexes or a second running summary. One lead overwrites the task file with actual current state; subagents communicate to the lead. Follow [GIT_WORKFLOW.md](../workflows/GIT_WORKFLOW.md) for the real source-feature PR gate and post-merge clearing protocol. A simulated fixture PR cannot clear the development task.

Active memory notes require frontmatter `id`, `date`, `status`, `tags`, and exactly four main sections: Context, Decision, Consequences, Affected files. Prefer fewer than 200 lines. Finalized decisions live in `nutshell-vault/decisions/YYYY-MM-DD-topic.md`, tagged by affected subsystem, with a stable `decision_key`; at most one accepted active note may govern that key. Supersede by updating active guidance/links, removing the old index entry and moving the old conflict to `archive/` with explicit supersession links. Do not accumulate conflicting rules or append-only feature histories.

Every connected repository has its own root `nutshell-vault/` and `.nutshell/`. The two local fixture repositories are distinct repositories with their own vaults, IDs, grants, and revisions. Never index the starter's architecture notes as fixture project data merely because the folder name matches. An indexed document is addressed by repository ID, immutable revision, and relative path. No directory beside each source file is required.

### Canonical data ownership

| Data | Authoritative home | Website treatment |
| --- | --- | --- |
| Shared narrative memory and decisions | Tracked `nutshell-vault/**/*.md` | Read/index at one Git revision |
| Memory registry and current task | `_INDEX.md` and `CURRENT_TASK.md` within that vault | One registry and one lead-owned task; never replace source PR evidence with fixture events |
| Entity identities, relationships and path mappings | `.nutshell/entities/<id>.json` | Project into graph and entity pages |
| Semantic change records | `.nutshell/changes/<id>.json` | Preserve accepted history and its provenance |
| Format and proposed coverage configuration | `.nutshell/config.json` | Validate against trusted service/base policy |
| Sessions, memberships, connections and tokens | PostgreSQL | Server-only identity and access state |
| Team tasks, deadlines and structured notes | PostgreSQL | Mutable collaboration records with revisions |
| Unpublished vault editor drafts | PostgreSQL | User-scoped proposed Markdown tied to source/base revisions |
| Git-derived views and search index | PostgreSQL | Rebuildable while source revisions remain available |
| Observed review/capture facts and audit events | PostgreSQL | Retained evidence, distinct from agent declarations |
| Screenshot bytes | Private asset provider | Authorized proxy delivery |
| Graph layout and open panels | User preferences | Presentation only |

The JSON contract contains small structural records and links to Markdown through `memory_paths`. It does not duplicate long-form explanations. Required Markdown frontmatter supplies retrieval/lifecycle metadata; it does not compete with JSON authority over product entity identity or history. Do not implement two competing entity formats.

A CodeMirror edit is a persisted server-side draft tied to a repository/path, immutable base commit/blob and optimistic draft revision. Preview renders the draft without promoting it to canonical knowledge. A stale draft/source save or submission returns a conflict with the user's text preserved. Publishing creates a repository proposal through the provider; the default branch remains unchanged until merge. Saving a Tiptap team note instead updates PostgreSQL. Neither dragging a graph node nor completing a task creates a code commit. Promoting a team decision into shared agent memory is an explicit repository change. A local agent sees its checkout, not live database notes, unless given a task brief or a future authorized API.

### Retrieval and maintenance

The root `AGENTS.md` contains a short managed Nutshell section while preserving owner-authored instructions. It instructs agents to read `_INDEX.md` first, then `CURRENT_TASK.md`, then relevant subsystem notes/decisions. More specific instruction files must be inspected; a marker is not an immutable policy or a guarantee that a client loaded the instructions.

Retrieve the task's path matches, titles, summaries, and lexical matches first; follow a small number of useful decision/entity links. Exclude `archive/` and superseded/deprecated/archived records from the active index and default search, retrieval, backlinks expansion and graph neighborhoods. Discover archived content through explicit historical search, not the default index. Load accepted decisions only when their subsystem is relevant. Return source paths, effective revision, ranking reasons, and truncation/budget information. Working-tree knowledge is explicit. Never combine an older checkout with latest-main memory without saying so. Generated caches are reproducible implementation data, not another curated index.

Agents update relevant memory, entity records, and change records in the same development workflow. A declaration of no product impact needs a reason. Validation checks format and traceability; it cannot prove an explanation true. Avoid raw agent transcripts, copied source trees, secrets, and invented explanations.

### Durable projection and access lifecycle

1. Verify webhook HMAC over the raw body and validate the event/action. In one database transaction record the receipt and enqueue work, or record a transactional outbox entry. Acknowledge only after durable acceptance.
2. A job captures repository ID, installation ID, connection epoch, source revision, schema version, and trusted policy version. Read one immutable tree and parse bounded data without executing project code.
3. Write a complete immutable snapshot. Distinguish PR drafts from valid default-branch snapshots. Deduplicate semantic events independently of delivery receipts.
4. Before promoting a snapshot, recheck the connection's active status and epoch, and reconcile the authoritative default-branch head. Use per-repository serialization or compare-and-swap to keep older work from replacing a newer current snapshot. Display the indexed revision; eventual synchronization is not instantaneous.
5. Suspension, removal, deletion, or ownership transfer invalidates the connection and increments its epoch. Already queued work may not reactivate a connection or publish under its old association. Restoration requires a fresh authoritative provider check, not replaying an old installation event.

The connection epoch protects worker publication; it does not replace current per-user authorization. Apply authorization before reading or returning repository data, search matches, exports, notes, tasks, source text, and media. A previously indexed snapshot is not a permanent access grant. On provider failure, fail closed for protected reads instead of using installation authority as a user fallback.

A repository transfer does not automatically transfer its old workspace's private notes, tasks or membership. Keep that association inaccessible until an authorized migration or reconnection policy resolves ownership.

Failed indexing keeps the last valid snapshot with a visible stale/error state. Revocation blocks even that snapshot. Jobs retry with bounded backoff, expose failures, and support reconciliation. External operations such as PR creation need their own idempotency keys and lookup-after-timeout behavior. Tasks, notes, stored evidence, and assets need backup; the entire database is not reconstructible from Git.

### Local alpha and evidence

The local provider persists two private repositories, immutable trees, default-branch pointers, users/grants, installations, branches, PRs, checks, and relevant failure scenarios. Scenario commands change source content and send signed deliveries through the actual ingress. Test duplicate/out-of-order deliveries, stale jobs, failed indexing, revocation, and installation removal.

Synthetic personas create real database sessions through a supported server-side auth path. Browser-provided roles or headers never grant permission. Set `NUTSHELL_MODE=local-alpha|live` and `NUTSHELL_DEPLOYMENT=local|hosted` explicitly. Local alpha uses a dedicated database, binds to loopback, and shows simulation labels. Hosted configuration rejects local-alpha mode, and live mode rejects fixture identities/providers; missing live credentials never silently enable them. An optimized local build may still use explicit local providers, so `NODE_ENV` alone is not the isolation boundary.

Canonical current history means a validated default-branch revision. A merged change is not evidence of deployment. Display deployment unknown until an actual deployment integration exists. Synthetic merge, review, and capture records remain visibly synthetic; an agent review never becomes a human review.

### Untrusted content and collaboration

Sanitize rendered Markdown; never evaluate MDX, repository scripts, HTML event handlers, or configuration-supplied commands. Bound input sizes, parse depth, counts, and graph expansion. Reject unsafe paths and symlink escapes. Block automatic remote image loading and server-side fetching of arbitrary repository URLs. Screenshot bytes must resolve through a repository-owned asset record, not a user-supplied URL or storage key.

Serve allowed image formats through an authenticated proxy with private/no-store responses. Preserve referenced evidence or show that it is unavailable. An image's declared SHA/time/environment is not verified capture provenance. Previously downloaded bytes cannot be recalled.

Tasks use date-only deadlines, one assignee, entity links, and optimistic revisions. Team notes retain editor JSON and an optimistic revision. A stale write returns a conflict, preserving the submitted draft for reconciliation. Assigning a task does not invite someone, grant GitHub access, or send a message. Keep the authorization and immutable-source rules in [GITHUB_CONTRACT.md](GITHUB_CONTRACT.md) as acceptance boundaries.

## Consequences

The local product can demonstrate the complete GitHub-boundary workflow without live product credentials. Development features nevertheless require a configured real source remote, authentication and authorized push/PR operations before the first feature; missing prerequisites permit independent setup/docs, not starting features. Completed feature merges leave CURRENT_TASK active on the default branch until a verified, separately authorized cleanup write applies; pending cleanup blocks the next feature. Source-work checkpoints and product collaboration tasks are different concepts.

Archiving a note changes current retrieval, not accepted history. Current entity references must point to active notes; an immutable accepted change retains narrative links at its original source revision. Missing historical evidence is reported rather than rewritten or invented.

## Affected files

- `SPEC.md`, `AGENTS.md`, `nutshell-vault/_INDEX.md`, `nutshell-vault/CURRENT_TASK.md` and relevant subsystem notes.
- `apps/web`, `apps/worker`, `packages/core`, `packages/server`, `packages/cli` when implementation is authorized.
- Each connected repository's distinct vault, `.nutshell` records, validated projections, collaboration rows and private assets.
