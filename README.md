# Nutshell

**Your codebase. In a Nutshell.**

A web app for individuals or teams to visualize, understand, and collaborate on AI-assisted GitHub projects.

This workspace contains the supplied logo, agent instructions, the local-alpha specification, and the managed memory vault. The vault validation CLI is available. Web and worker startup are planned.

## Start locally

1. Extract this folder into your chosen local project directory. If you already have a Nutshell checkout, merge these instructions deliberately and preserve existing work.
2. Open the folder in your local coding-agent client. Select your intended model/effort and set its execution permissions before the unattended run. These documents do not change client permissions.
3. Prepare Git with a real commit identity, a supported Node.js LTS runtime, and local PostgreSQL. Docker is optional. The coding run implements pinned dependencies, setup scripts, browser tests, and application configuration. See [LOCAL_SETUP.md](nutshell-vault/workflows/LOCAL_SETUP.md).
4. Select the **real GitHub source repository** for building Nutshell and make sure the agent can push feature branches and open PRs there. Every feature must use a PR. To complete the run without human merge steps, the exact repository operations must already be authorized and its existing checks/review policy must allow them. Configure required PR/check protections where available; do not remove existing protections to make the run unattended.
5. Start with the instruction below. Keep the computer awake and online. No hosted development environment is required; using GitHub for source PRs is separate from where the app and coding agent execute.

## Start the first megarun

```text
Implement Nutshell locally from this starter workspace.

Read AGENTS.md, then nutshell-vault/_INDEX.md first and
nutshell-vault/CURRENT_TASK.md next. Read SPEC.md once to plan this run.
Follow nutshell-vault/design/UI_GUIDE.md exactly for UI work and preserve
assets/brand/nutshell-logo.png.

Inspect existing work and complete the local and source-PR preflight.
Use the selected, authorized GitHub source repository for feature branches
and real PRs. Respect its existing checks and merge authorization.

Use one lead agent and one active feature task at a time. Delegates may
work in parallel within that feature and report progress to the lead.
Read only relevant notes selected through _INDEX. The lead overwrites
CURRENT_TASK with concise current state; commit code and affected memory
in small coherent slices and open the feature PR early.

After the exact feature PR is confirmed merged, follow the guarded cleanup
workflow to clear CURRENT_TASK. Finish canonical cleanup before starting
the next feature. Do not substitute simulated PRs for source-development PRs.

Continue through implementation, verification, repairs, and documentation
without milestone approval pauses. Make routine reversible decisions,
preserve unrelated work, and complete independent authorized work before
reporting an unavoidable blocker.

Run the app, database, worker, and tests locally. Report local application,
simulated-provider, live-provider, and source-PR evidence separately.
Finish with exact startup commands and an honest acceptance ledger.
```

## Revised memory system

| Path | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Required reading order, lead ownership, small commits, feature PRs, note upkeep |
| [SPEC.md](SPEC.md) | Complete first-megarun requirements and acceptance gates |
| [nutshell-vault/_INDEX.md](nutshell-vault/_INDEX.md) | One lightweight catalog of every active managed Markdown file, with descriptions and tags |
| [nutshell-vault/CURRENT_TASK.md](nutshell-vault/CURRENT_TASK.md) | One current feature brief, initially idle, overwritten by the lead and cleared after verified merge/cleanup |
| `nutshell-vault/features/` | Concise current context organized by subsystem |
| `nutshell-vault/decisions/` | Short dated finalized choices; read only when relevant |
| `nutshell-vault/archive/` | Superseded notes and former routing files; excluded from default reads |
| [NOTE.md](nutshell-vault/templates/NOTE.md) | Context, Decision, Consequences, Affected files |
| [GIT_WORKFLOW.md](nutshell-vault/workflows/GIT_WORKFLOW.md) | PR lifecycle and safe post-merge task cleanup |
| [UI_GUIDE.md](nutshell-vault/design/UI_GUIDE.md) | Exact fifteen design requirements |
| [ACCEPTANCE.md](nutshell-vault/runs/ACCEPTANCE.md) | Verification ledger; application gates initially not run |

The index is the only active router; old nested indexes and the former run checkpoint have been archived. Notes target fewer than 200 lines. Replacing a decision requires marking the previous note superseded, archiving it, and updating the active index and references together.

## Validate the vault locally

Use Node 24.18.0 and pnpm 11.25.0 from the repository root.

```powershell
pnpm install --frozen-lockfile
pnpm nutshell --help
pnpm nutshell validate --working-tree
pnpm lint
pnpm typecheck
pnpm test
```

Use `pnpm nutshell validate --base <ref> --head <ref>` for the vault at the resolved Git head. Setup, web, worker, and context retrieval commands are tracked in [the specification](SPEC.md).

The product's local-alpha mode uses real persistence and application logic with a simulated external GitHub provider. It does not require live product GitHub App credentials. **Building Nutshell still requires the real source PR workflow above.** Simulated product merges cannot clear the development task or prove a source PR was merged. Report the two evidence classes separately.

The supplied [original logo](assets/brand/nutshell-logo.png) is unchanged and has an opaque light background. Follow [BRAND.md](nutshell-vault/design/BRAND.md) when placing it on the dark interface.
