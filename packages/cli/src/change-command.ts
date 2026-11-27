import { hasMeaningfulRepositoryChangeText } from "@nutshell/core/change-validation";
import { projectRepositoryTree, repositoryChangeSchema, type RepositorySnapshotIssue } from "@nutshell/core/snapshot";
import { applyAuthoringEdits, readAuthoringTree } from "./authoring-files.ts";

const help = `Usage:
  pnpm nutshell change add --id <id> --type <type> --summary <text>
    --impact <user_visible|internal|none> --rationale <text> --technical-summary <text>
    [--entity <id> ...] [--memory <path> ...] [--corrects <id> | --reverses <id>] [--json]

Create one change record in the current repository working tree. Repeat --entity and --memory for each affected entity and active memory path.
Types: added, changed, fixed, deprecated, removed, reverted, corrected.
User-visible changes need an entity. Use --corrects with corrected or --reverses with reverted.`;

const required = ["--id", "--type", "--summary", "--impact", "--rationale", "--technical-summary"];
const scalarFlags = new Set([...required, "--corrects", "--reverses"]);
const scope = "change-authoring";
const source = { kind: "working-tree" };

export function runChangeCommand(args: readonly string[], cwd: string): number {
  if ((args.length === 1 && args[0] === "--help") || (args.length === 2 && args[0] === "add" && args[1] === "--help")) {
    console.log(help);
    return 0;
  }
  if (args[0] !== "add") throw new Error("Expected change add. See change --help.");

  const { values, entities, memory, json } = parseAddOptions(args.slice(1));
  const result = repositoryChangeSchema.safeParse({
    schema_version: 1,
    id: values.get("--id"),
    entity_ids: entities,
    change_type: values.get("--type"),
    summary: values.get("--summary"),
    product_impact: values.get("--impact"),
    rationale: values.get("--rationale"),
    technical_summary: values.get("--technical-summary"),
    memory_paths: memory,
    evidence: [],
    ...(values.has("--corrects") ? { corrects_change_id: values.get("--corrects") } : {}),
    ...(values.has("--reverses") ? { reverses_change_id: values.get("--reverses") } : {}),
  });
  if (!result.success) {
    return reportIssues(result.error.issues.map((issue) => ({
      path: ".nutshell/changes",
      code: "record-schema",
      message: `Invalid ${issue.path.join(".")} field. See change add --help.`,
    })), json);
  }

  const change = result.data;
  const path = `.nutshell/changes/${change.id}.json`;
  if (!hasMeaningfulRepositoryChangeText(change)) {
    return reportIssues([{ path, code: "change-placeholder", message: "Use a specific summary, rationale and technical explanation." }], json);
  }

  const files = readAuthoringTree(cwd);
  if (files.has(path)) {
    return reportIssues([{ path, code: "record-duplicate", message: "A record with this ID already exists." }], json);
  }
  const base = projectRepositoryTree(files);
  if (!base.ok) return reportIssues(base.issues, json);

  const body = JSON.stringify(change, null, 2) + "\n";
  const priorChanges = new Map(base.snapshot.changes.map((record) => [record.id, record]));
  files.set(path, body);
  const candidate = projectRepositoryTree(files, { acceptedChanges: priorChanges });
  if (!candidate.ok) return reportIssues(candidate.issues, json);

  applyAuthoringEdits(cwd, [{ path, body }]);
  if (json) console.log(JSON.stringify({ scope, source, ok: true, path, change }, null, 2));
  else console.log(`Created ${path}`);
  return 0;
}

function parseAddOptions(args: readonly string[]) {
  const values = new Map<string, string>();
  const entities: string[] = [];
  const memory: string[] = [];
  let json = false;
  const options = args.values();
  for (const flag of options) {
    if (flag === "--json") {
      if (json) throw new Error("Repeated option --json.");
      json = true;
      continue;
    }
    if (!scalarFlags.has(flag) && flag !== "--entity" && flag !== "--memory") {
      throw new Error(`Unknown change option ${JSON.stringify(flag)}. See change add --help.`);
    }
    if (values.has(flag)) throw new Error(`Repeated option ${flag}.`);
    const value = options.next().value;
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    if (flag === "--entity") entities.push(value);
    else if (flag === "--memory") memory.push(value);
    else values.set(flag, value);
  }
  const missing = required.filter((flag) => !values.has(flag));
  if (missing.length) throw new Error(`Missing required options ${missing.join(", ")}. See change add --help.`);
  return { values, entities, memory, json };
}

function reportIssues(issues: readonly RepositorySnapshotIssue[], json: boolean): number {
  if (json) console.log(JSON.stringify({ scope, source, ok: false, issues }, null, 2));
  else for (const { path, code, message } of issues) console.error(`${JSON.stringify(path)} [${code}] ${message}`);
  return 1;
}
