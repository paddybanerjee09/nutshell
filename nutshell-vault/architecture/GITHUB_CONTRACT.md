---
id: architecture-github-contract
date: 2026-11-26
status: active
tags: [architecture, github, repository-format, provenance]
---
# Repository format and GitHub contract

## Context

This document is the canonical small-format contract for the alpha. `SPEC.md` defines product scope; [SYSTEM.md](SYSTEM.md) defines storage ownership and execution. These are proposed Nutshell formats, not existing GitHub standards. Primary provider references are listed in [SOURCES.md](SOURCES.md).

## Decision

### Repository layout and identity

Each assisted repository contains:

| Path | Contract |
| --- | --- |
| `AGENTS.md` | Owner instructions plus a small managed Nutshell section |
| `nutshell-vault/_INDEX.md` | One exhaustive active managed Markdown registry, including root AGENTS/SPEC/README references; no archived entries |
| `nutshell-vault/CURRENT_TASK.md` | One lead-owned overwrite-in-place task, cleared only after its matching provider-confirmed feature merge; source development requires real GitHub evidence, while isolated fixture tasks may use explicitly synthetic provider evidence |
| `nutshell-vault/**/*.md` | All shared narrative memory, including decisions and feature explanations |
| `.nutshell/config.json` | Schema version, vault root, registered entity kinds and proposed source coverage |
| `.nutshell/entities/<id>.json` | One structural product entity |
| `.nutshell/changes/<id>.json` | One semantic change event |

Do not place narrative memory under `.nutshell/`, commit screenshot binaries, or add a Nutshell folder beside every source file. Generated caches are ignored. The starter's development vault and each fixture/customer vault are separate: all reads and projections are scoped by repository ID and immutable revision. No synthetic event may mutate or certify the real workspace's CURRENT_TASK.

Read `_INDEX.md` first, then `CURRENT_TASK.md`, then relevant notes. Group current feature memory under `nutshell-vault/features/<feature>/CONTEXT.md`. Finalized decisions live in top-level `nutshell-vault/decisions/YYYY-MM-DD-topic.md`, tagged by subsystem and loaded only when relevant. Do not create append-only HISTORY files or secondary indexes. `.nutshell/changes/` remains the canonical semantic event format for the product timeline.

Every JSON record uses `schema_version: 1`. Export strict schemas from the shared core and use the same parser in the CLI and service. Reject incompatible versions, duplicate IDs, unexpected fields, unresolved references and unsafe paths. IDs are immutable, opaque, repository-scoped strings; filenames equal the record ID, independently of a mutable title. Choose and document bounded identifier/string/array limits in the schema.

Paths are repository-relative POSIX paths. Reject absolute paths, traversal, backslashes, NUL bytes, `.git` access and symlink escapes. `code_paths` permits a documented bounded glob syntax; `memory_paths` contains literal Markdown paths under `nutshell-vault/`. Current entity links and new change links resolve at the parsed revision. Accepted historical change links stay bound to their original accepted revision, so later archiving does not rewrite their payloads. Cross-repository links do not authorize retrieval.

### Small record shapes

The examples use synthetic names. Fields shown are required except where explicitly described as optional.

#### Configuration

`.nutshell/config.json`:

```json
{
  "schema_version": 1,
  "vault_root": "nutshell-vault",
  "entity_kinds": [
    {"slug": "feature", "label": "Feature"},
    {"slug": "screen", "label": "Screen"},
    {"slug": "service", "label": "Service"},
    {"slug": "module", "label": "Module"},
    {"slug": "level", "label": "Level"}
  ],
  "coverage": {
    "include": ["src/**"],
    "exclude": ["src/generated/**"]
  }
}
```

The record directories are fixed in v1. Register the four default kinds and optionally add bounded unique custom slugs/labels, such as `level`. Kinds affect organization and presentation only: they never grant access, select executable behavior or relax required fields. Candidate snapshots may add valid display-only kinds; deleting or renaming a used slug requires an explicit migration, not silent reinterpretation.

Configure coverage for the actual repository instead of assuming a JavaScript layout. A proposed config change is not permission to exempt its own PR. Use service minimums plus trusted service/base-revision coverage policy; snapshot the policy version used. Bootstrap without a trusted config uses service-owned defaults. Weakening requires explicit authorized policy acceptance outside the proposing PR's own validation result.

#### Entity

`.nutshell/entities/ent_team_invites.json`:

```json
{
  "schema_version": 1,
  "id": "ent_team_invites",
  "kind": "feature",
  "title": "Team invitations",
  "summary": "Invite a teammate into a workspace.",
  "lifecycle": "active",
  "code_paths": ["src/invitations/**"],
  "memory_paths": ["nutshell-vault/features/team-invitations/CONTEXT.md"],
  "relations": [
    {"type": "depends_on", "target": "svc_identity"}
  ]
}
```

Supply the referenced service in a valid fixture. `kind` must match a registered `entity_kinds.slug`; the defaults are `feature`, `screen`, `service`, and `module`. `lifecycle` is `planned`, `active`, `deprecated`, or `removed`. Optional `display_group` groups entities without changing their identity. Optional `screen` contains `route_patterns` for screen entities; these are descriptive routes, not URLs to fetch. Custom kinds use the same common entity schema and have no special access rights.

Relationship types are `part_of`, `depends_on`, `implemented_by`, and `appears_on`. Resolve targets within the same repository snapshot. Reject cycles in `part_of`; dependency cycles may be legitimate. Planned entities may lack code. Report unmatched active code paths and absent narrative memory instead of claiming a complete map. Retain tombstones/IDs for removed entities so historical references survive.

Memory-note frontmatter requires `id`, `date`, `status`, `tags`; the only main headings are Context, Decision, Consequences, Affected files. Keep notes under 200 lines where possible. Decision notes additionally require `decision_key`; permit at most one accepted active note per key. Supersession links are repository-relative and must resolve. Update `_INDEX.md`, current guidance, links and entity memory references when replacing a note; archive the superseded conflict instead of leaving both active. Default retrieval excludes `archive/` and superseded/deprecated/archived statuses; explicit historical retrieval may include them. Entity identity, lifecycle, relationships and change payloads remain authoritative in JSON.

#### Change

`.nutshell/changes/chg_invite_expiry.json`:

```json
{
  "schema_version": 1,
  "id": "chg_invite_expiry",
  "entity_ids": ["ent_team_invites"],
  "change_type": "changed",
  "summary": "Invitation links now expire after the configured period.",
  "product_impact": "user_visible",
  "rationale": "Limit the lifetime of unused invitations.",
  "technical_summary": "Validate the expiry before accepting an invitation.",
  "memory_paths": ["nutshell-vault/decisions/2026-11-26-invitation-expiry.md"],
  "evidence": []
}
```

`change_type` is `added`, `changed`, `fixed`, `deprecated`, `removed`, `reverted`, or `corrected`. `product_impact` is `user_visible`, `internal`, or `none`. A user-visible event needs affected entities. Internal/no-impact declarations may have an empty entity list but require a meaningful rationale; covered unmapped source changes still need a diagnostic and classification. Long explanations belong in referenced memory.

Optional `issue_numbers` and `pull_request_numbers` are same-repository references, not proof of a merge. A reverted event requires `reverses_change_id`; a correction requires `corrects_change_id`. Validate those targets. Drafts are revisioned by repository, change ID and PR head. On canonical publication preserve the accepted payload/hash and first introduction revision. Unchanged files do not create repeated events. Reject silent mutation/removal of a published payload; record a new correction or reversal instead. Validate new event narrative links at the PR head; resolve unchanged historical links at their retained accepted revision, reporting unavailable history when that revision is missing. Retained events are not erased by later archiving, missing files or force pushes.

Do not put the containing commit SHA inside the file itself. Ingestion attaches the actual containing revision and provider-observed merge facts. The website must not treat agent-supplied author/reviewer fields as authenticated evidence.

#### Screenshot evidence

An optional entry in a change's `evidence` array has this shape:

```json
{
  "kind": "screenshot",
  "asset_id": "asset_invite_empty",
  "source_revision": "1111111111111111111111111111111111111111",
  "route": "/invite/demo",
  "state": "empty-form",
  "viewport": {"width": 1440, "height": 900},
  "environment": "local-alpha",
  "captured_at": "2026-11-26T12:00:00Z"
}
```

The all-ones revision is an illustrative placeholder, not a real capture. An optional `capture_ref` links a capture run. Validate supported Git object-ID formats without assuming every provider forever uses one hash length. Resolve `asset_id` through a server-owned record with the same repository, byte digest, allowed MIME type, size, private storage locator and provenance status. The JSON declaration alone does not verify the source revision, environment, timestamp or capture run. Display supplied evidence as declared; only trusted observations or explicitly labeled fixture evidence can establish more.

No arbitrary URL, absolute path, expiring signed URL or raw object key belongs in this record. Missing bytes produce an unavailable-evidence state. Do not fetch Markdown image URLs. Source/route strings are display data and must not become a request to execute or visit an arbitrary application.

### Vault editor drafts

CodeMirror edits `nutshell-vault/` Markdown as source with sanitized live preview. Persist a server-side draft containing repository/workspace IDs, author ID, literal path, base commit, base blob ID (or explicit nonexistence for a new file), proposed text and optimistic revision. The file content remains untrusted. A user may not save a draft against another repository's path by changing browser fields.

Require current repository write capability for canonical-source draft creation/editing and submission; readers may use team notes instead. Save includes the expected draft revision. Before save/submission, compare the relevant current source to the recorded base; a changed blob, deleted/renamed source or conflicting draft returns HTTP 409 with both the user's text and reconciliation information. An unrelated newer commit may be rebased only after confirming the source blob is unchanged and recording the refreshed base.

Submission creates/updates an idempotent branch and PR using current user authority. Do not overwrite the default branch, existing user edits or a changed PR branch. Store the resulting provider identifiers and head revision. Canonical indexing changes only after a validated merge. Local providers implement the same draft/conflict/proposal semantics with explicit synthetic merge events. Saving a draft or displaying its preview never claims a canonical memory update.

### GitHub identities and access

Use a GitHub App. Its user token is bounded by both the user's and app's access; its installation token represents the app independently. Use user tokens for user-requested branches, commits, PRs and future issue writes; use installation tokens for authorized background reads and app-owned Checks. Never retry a failed user operation with installation authority. [GH1, GH2]

Use stable numeric IDs for users, repositories, organizations and installations; resolve mutable names for display. The repository's owning account can be an organization, not a single human. The installer gets no permanent ownership override. Current organization roles include Read, Triage, Moderate, Write, Maintain and Admin, with custom roles in supported plans. Preserve role labels and evaluate verified capabilities rather than a fabricated Owner/Contributor rank. [GH2, GH3, GH4]

Every protected request requires a valid database session, active local membership, an active installation covering the repository, and sufficient current provider access. Verify current user access per request in the alpha; reuse results only within that request. Apply this before protected data, search or media leaves the server. Provider failure denies access with an appropriate error. Membership can narrow access and may be provisioned from a verified private-repo grant; it cannot expand GitHub access.

Readers may view knowledge and create their own notes/tasks. Coordinators initially require verified code-write/maintain/admin capability and may assign eligible repository members. This is Nutshell policy, not a GitHub permission for task blocks. Configuration needs verified repository administration authority. Billing, if later added, never grants repo access. Unknown custom-role capabilities are denied conservatively. No implicit invitations or access grants occur.

Better Auth supplies sessions and the GitHub provider. Confirm state, PKCE S256, trusted origins, secure cookies, encrypted stored tokens and actual GitHub App refresh behavior. GitHub App expiry/refresh behavior must not be confused with generic OAuth-app tokens; maintain an explicit encrypted token lifecycle service if needed. Never synthesize user consent. [GH1, AUTH1]

### Permissions and onboarding

| GitHub App permission | Alpha use |
| --- | --- |
| Metadata read | Repository identity/access metadata |
| Contents write | Read tracked files and create setup commits |
| Pull requests write | Open setup proposals and inspect PRs |
| Checks write | Publish independent validation |
| Account Email addresses read | Selected Better Auth GitHub App provider configuration |

Narrow installation credentials for routine reads where supported. Do not request Workflows, Actions, Issues, Deployments, Members or Administration for unimplemented features. Validation runs in Nutshell's worker, so setup does not modify `.github/workflows`. Editing workflow files would require additional permission. [GH5, AUTH1]

After verified sign-in and installation, validate configuration authority and installation/repository association; callback query IDs are not proof. Read the current default-branch revision and existing instruction files. Create an atomic setup commit where practical, preserve owner guidance, and open an idempotent setup PR with a stable operation marker. Refresh a changed base safely. Do not overwrite existing `AGENTS.md`, push directly to a customer's default branch, or merge without exact prior authorization.

Local scenarios explicitly simulate installation and merging, then emit signed events into real ingress. Live product installation/OAuth/merge tests require preauthorized disposable resources; absent product credentials do not stop local product testing. This does not replace Nutshell's development remote or real source-feature PR gate. Source PR setup and cleanup follow [GIT_WORKFLOW.md](../workflows/GIT_WORKFLOW.md). Private GitHub.com same-repository PRs are the product integration target; fork PRs and merge queues remain unsupported until implemented and tested.

### Checks and synchronization

Fetch all validation input at the exact immutable PR head. Run service-owned parsing/policy code without executing customer scripts, dependencies or validators. A PR cannot change coverage, schema or local validator files to weaken its own gate. Publish a Check against that exact revision; validate the actual merged tree again before current publication. Unsupported cases must not produce a successful check. [GH6]

Administrators may require the app-sourced check where their plan/settings support it. Show validation status separately from merge enforcement and bypass configuration. Instructions cannot make a customer's repo unmodifiable. Do not claim schema validity proves semantic correctness or human review. [GH7]

Handle `push`, `pull_request`, `repository`, automatic installation/repository-selection events and app-authorization revocation. Add check-rerun events only with corresponding handlers. Exact subscriptions/actions must match current permission requirements; do not assume membership events are available without Members permission. [GH8]

Verify raw-body HMAC, durably accept receipt/work, then acknowledge promptly. Deduplicate by delivery ID; valid redelivery can reuse that ID. GitHub does not automatically retry failed deliveries, so provide reconciliation and inspectable recovery. Preserve snapshot keys `(repository_id, revision, schema_version, policy_version)` and a connection epoch as described in SYSTEM.md. Out-of-order work must not regress the current pointer or resurrect revoked/transferred associations. [GH9, GH10]

Default-branch knowledge is canonical after validation. PR state is draft. Merged does not mean deployed: display deployment unknown without trusted deployment evidence. Keep declared/inferred/observed/agent-reviewed/human-reviewed states distinct, and label every simulated provider fact as synthetic.

## Consequences

The source-work CURRENT_TASK remains active until its exact feature PR is confirmed merged, then clears through a separate authorized write or cleanup-only PR. Check task ID, repository/PR identity, observed head and current blob/base; an old event cannot clear newer work. Pending canonical cleanup blocks the next feature, and cleanup PRs do not recursively create tasks. A simulator event cannot satisfy this real merge gate. [GH11, GH12]

The single registry records every active managed Markdown file, including root AGENTS/SPEC/README control references, and no archived entries. Historical discovery requires explicit archive search. Supersession removes current conflicts while immutable event links preserve their historical revision. A local validator can enforce format/workflow checks, but actual GitHub PR/check protection must be configured separately and truthfully reported. [GH7]

## Affected files

- Connected-repository `AGENTS.md`, `nutshell-vault/_INDEX.md`, `nutshell-vault/CURRENT_TASK.md`, active subsystem notes and `archive/`.
- `.nutshell/config.json`, `.nutshell/entities/*.json`, `.nutshell/changes/*.json`; shared core schemas and server/CLI consumers.
- Repository-scoped sessions, drafts, projections, assets, job/connection state and real development PR metadata.
