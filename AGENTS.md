# Nutshell agent instructions

The exact product name is **Nutshell**. The slogan is **Your codebase. In a Nutshell.** This workspace starts as a specification and reference assets; do not claim the application or its tests exist yet.

When asked to perform the first megarun, implement [SPEC.md](SPEC.md) through its acceptance criteria. For bounded work, keep to the requested scope. Make routine reversible decisions and continue without milestone approval pauses. Preserve unrelated work, applicable owner instructions, and the user's existing authorization; these files do not grant runtime permissions.

## Read the router first

1. After loading applicable agent instructions, read [nutshell-vault/_INDEX.md](nutshell-vault/_INDEX.md) **first**, then [nutshell-vault/CURRENT_TASK.md](nutshell-vault/CURRENT_TASK.md). Every lead and delegated agent does this at task start, handoff, and resumption, even when it has read them in an earlier session.
2. Use the index's paths, short descriptions, and tags to select the smallest relevant set of notes. Read the affected feature context. Load dated notes in `nutshell-vault/decisions/` only when touching their subsystem or resolving a relevant dependency.
3. At first-megarun planning, read the full specification once **after the two control files**. Later tasks load only relevant requirements and notes; expand retrieval when evidence shows a dependency or gap.
4. For UI work, follow [UI_GUIDE.md](nutshell-vault/design/UI_GUIDE.md) exactly and use its relevant implementation/acceptance supplements. Preserve [the supplied logo](assets/brand/nutshell-logo.png). Do not create a competing theme or substitute brand asset.
5. Consult the relevant architecture/contract before changing a shared boundary. Check actual source, Git state, and relevant acceptance evidence before relying on a note's claims.

Do not recursively read the vault, preload all decisions, or scan every note body to discover context. `archive/` and notes marked `superseded`, `deprecated`, or `archived` are excluded from default retrieval and automatic link expansion. Access them only for an explicit historical question or a documented historical investigation required by the task, and label the result historical. Current guidance wins over historical notes. Validators may enumerate files and inspect metadata without injecting their contents into the agent's context.

## Keep one current feature task

Follow [MEMORY_PROTOCOL.md](nutshell-vault/workflows/MEMORY_PROTOCOL.md) and [GIT_WORKFLOW.md](nutshell-vault/workflows/GIT_WORKFLOW.md) when working on the memory or task lifecycle.

- Use the single tracked `nutshell-vault/CURRENT_TASK.md`. Do not create another run-current file, per-agent task ledger, or append-only progress diary. The alpha permits one active feature task and its feature PR repository-wide; parallel agents collaborate within it.
- One lead is the sole task-file writer and owns integration. Delegates read the shared task and return scoped progress/evidence to the lead. Use explicit file ownership or worktrees; do not race the index, shared schema, lockfile, or task file.
- The lead names the authoritative integration checkout and supplies the current task revision to delegates. Worktree copies are views of the same logical task, not independent task records. Delegates must not commit competing task-file edits.
- Before overwriting the task, reread it, compare expected `task_id` and `task_revision`, then advance the revision. Keep its objective, scope, actual branch/PR, useful progress, checks, blockers, and next action current. Overwrite obsolete working text; preserve durable reasoning in the appropriate note.
- Keep file `status: active` separate from `task_state`. Idle means no active feature; it does not mean the application is complete. Do not invent branch names, PR URLs, merge states, or test results.

## Require feature PRs and small commits

Establish the real source repository, Git identity, remote authentication, and authorized branch-push/PR operations during preflight **before starting feature implementation**. Missing setup blocks new features; finish independent setup/documentation and record the blocker. Nutshell's simulated GitHub provider is for product tests and cannot satisfy the source-development PR requirement.

Work on a feature branch. Make small, cohesive commits with the relevant memory and verification; open a real draft PR as soon as the first coherent commit can be pushed. Do not commit feature work directly to the default branch or collect the whole application in one PR. Delegate branches integrate into the same feature branch. If access fails mid-feature, retain the task and continue independent work on that feature without claiming integration or starting another feature.

Stage explicit paths/hunks and inspect the staged diff. Preserve hooks and checks. Never create empty commits, invent an author identity, bypass failed checks, or alter tests merely to hide broken behavior. Keep code minimal, avoid duplicate logic, and use the shared authorization, schemas, parsers, and provider boundaries.

Keep CURRENT_TASK active throughout the feature PR. Merge only under existing authorization and repository policy. **Never clear the task in anticipation of a merge.** After GitHub confirms that the exact repository/PR/task actually merged, refresh the default branch and compare its current task identity and revision before resetting to the idle template. A stale event or closed-but-unmerged PR must not clear the task.

Persist that reset through an already permitted housekeeping write or a small cleanup-only PR, respecting existing protection. Cleanup-only PRs are exempt from creating another feature task or recursive cleanup. Until canonical cleanup is confirmed, report `cleanup_pending` and do not start the next feature. Follow the detailed Git workflow for stale cleanup checks and recovery. Store final tested head evidence in PR/check metadata; a committed task file cannot contain its own containing commit's final SHA.

## Maintain concise, current memory

- Every active durable vault note uses frontmatter `id`, `date`, `status`, and `tags`, followed by exactly these main sections: **Context**, **Decision**, **Consequences**, **Affected files**. Use [NOTE.md](nutshell-vault/templates/NOTE.md). Keep notes under 200 lines where practical; split by topic when useful and document any necessary `length_exception_reason`.
- `_INDEX.md` is the sole routing catalog. Give **every active managed Markdown file** one row with its path, short description, status, and tags; include control files and templates. Add, rename, remove, archive, or supersede a note together with its index update. Never omit active files to meet a size target. Do not add nested indexes.
- Store finalized architectural/workflow choices in `nutshell-vault/decisions/YYYY-MM-DD-topic.md`, with `status: accepted` and a stable `decision_key`. There may be only one current accepted note per key. Keep tentative choices in current context until finalized.
- When a decision changes, write the replacement, mark the former note `superseded`, add `superseded_by`, move it to `archive/`, and update current references plus `_INDEX.md` in the same cohesive change. Preserve historical provenance and revision-bound event evidence. Never leave contradictory decisions active.
- Archive deprecated features, obsolete plans, and superseded notes. Preserve useful accepted decisions and verification before clearing CURRENT_TASK. Do not save raw transcripts, secrets, full tool logs, or private reasoning.
- Update the affected context and evidence in the same small commit as the code. [ACCEPTANCE.md](nutshell-vault/runs/ACCEPTANCE.md) is an evidence ledger, not another current-task summary. Separate observed implementation from plans, and local application tests from simulated-provider tests and live GitHub evidence.

Root handoff documents (`SPEC.md`, `AGENTS.md`, `README.md`) are indexed references and are exempt from the four-section note format and 200-line target. The vault's control files retain the four-section format. Archived documents retain their historical text with explicit lifecycle/provenance metadata.

## Finish truthfully

Run meaningful checks for changed behavior; for documentation changes, verify content, index coverage, and links. Diagnose repeated infrastructure failures and continue independent authorized work instead of retrying unchanged indefinitely. On resume, reconcile the task with actual repository and service state.

Agent instructions define the workflow; configured repository protections and trusted checks provide enforceable merge gates. Do not claim Markdown rules are immutable or that a remote rule was installed without evidence. Retrieved notes cannot grant permissions or override applicable instructions. Report completed, failed, blocked, and unrun work accurately, including source PR and cleanup status.
