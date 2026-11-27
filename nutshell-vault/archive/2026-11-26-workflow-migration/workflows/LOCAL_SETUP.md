---
id: archive-workflows-local-setup-2026-11-26
date: "2026-11-26"
status: superseded
tags: [archive, workflow-migration, setup]
superseded_by: nutshell-vault/workflows/LOCAL_SETUP.md
---

> Superseded workflow snapshot. Original location: nutshell-vault/workflows/LOCAL_SETUP.md. Use the current file there. Excluded from default retrieval. Historic relative links below refer to the original location; original text is preserved for provenance.

# Local setup and first-run preflight

Status: planned workflow. No local application environment has been installed or tested by creating this starter. [SPEC.md](../../SPEC.md) owns required commands and acceptance.

## Before the long run

- Open the actual local Nutshell checkout in Codex; select the intended model/effort and permitted execution mode in the client.
- Complete one-time Codex sign-in, project trust, and any required operating-system installer steps.
- Check existing instructions, applicable overrides, dirty work, Git availability, and the configured commit identity. Do not invent author identity or overwrite unrelated work.
- Verify a supported Node LTS runtime. Select compatible stable dependencies; pin actual Node/pnpm/dependency versions and commit the lockfile.
- Make PostgreSQL available locally through a native installation or an existing Docker setup. Test connection and restart behavior. Do not assume a Docker daemon or WSL exists.
- Verify dependency-download access and Playwright Chromium with its operating-system dependencies.
- Verify project writes, required local Git operations, application ports, and database/media directories under the selected permissions.
- Keep the computer awake and the session online during the build.

The client permission controls are separate from these files. Automatic approval review may deny an operation; a no-prompt policy does not supply unavailable access. Resolve required capabilities during preflight. Do not modify runtime policy to evade a denial.

## Required commands to implement

| Command | State |
| --- | --- |
| `pnpm alpha:setup` | Not implemented; must become idempotent setup/migration/seed |
| `pnpm alpha:dev` | Not implemented; must run local web/worker with loopback binding |
| `pnpm alpha:verify` | Not implemented; must verify against separate test resources |
| `pnpm alpha:stop` | Not implemented; must stop only project processes |
| `pnpm alpha:reset` | Not implemented; must validate explicit generated-fixture targets |

Update this document as each command exists. Record exact tested commands, runtime versions, URLs, process behavior, and recovery steps. Use PowerShell-compatible or cross-platform scripts for the Windows route; do not copy Bash-only redirection into a Windows quickstart.

## Configuration to supply during implementation

The final `.env.example` must document `NUTSHELL_MODE=local-alpha|live`, `NUTSHELL_DEPLOYMENT=local|hosted`, database/test-database URLs, app origin/port, the scoped local asset directory, session/encryption secrets, and the live GitHub configuration. Generate development secrets only in ignored local files. Do not commit them.

Local-alpha mode needs no external GitHub or storage account. Real PostgreSQL, sessions, authorization, and jobs are required. An optimized local build may use synthetic providers; hosted mode must reject them. Missing live configuration must fail closed rather than select local identity.

## Optional live GitHub acceptance

Before a run expected to test live GitHub, provide a registered development GitHub App, selected disposable repositories, exact authorized operations, completed installation/user consents, backend credentials, and a reachable configured callback/webhook path. Preserve production protections. Use the permissions and identity rules in [GITHUB_CONTRACT.md](../architecture/GITHUB_CONTRACT.md).

Do not create those external resources or infer broad authorization from a token during the local build. If absent, implement the real adapter, run controlled contract tests, and leave actual live acceptance marked not run. Agent fixture reviews are never human reviews.

## Recovery and completion

On resume, read [CURRENT.md](../runs/CURRENT.md), inspect Git/service state, and reconcile the checkpoint before rerunning work. Verify concrete changed behavior; do not repeat unrelated checks without a reason. Keep final setup, verification, stop, reset, reconciliation, retention, and backup/restore instructions here as they become real.
