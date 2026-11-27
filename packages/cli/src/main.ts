const help = `Usage:
  pnpm nutshell init [--write] [--json]
  pnpm nutshell change add --help
  pnpm nutshell validate --working-tree [--json]
  pnpm nutshell validate --base <ref> --head <ref> [--json]
  pnpm nutshell impact --base <ref> --head <ref> [--json]
  pnpm nutshell context --help

Git comparison resolves both refs to commits and applies trusted repository
policy. Impact lists changed paths, entity and change IDs, and relevant notes.
Scope: vault snapshot checks only for --working-tree or validation before repository setup.`;

type Options =
  | { kind: "help" }
  | { kind: "working-tree"; json: boolean }
  | { kind: "git"; command: "validate" | "impact"; json: boolean; base: string; head: string };

function parseOptions(args: string[]): Options {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return { kind: "help" };
  }
  const command = args[0];
  if (command !== "validate" && command !== "impact") throw new Error("Expected init, change, validate, impact, or context. See --help.");
  if (args.length === 2 && args[1] === "--help") return { kind: "help" };

  const seen = new Set<string>();
  let base: string | undefined;
  let head: string | undefined;
  const flags = args.slice(1).values();
  for (const flag of flags) {
    if (seen.has(flag)) throw new Error(`Repeated option ${JSON.stringify(flag)}.`);
    seen.add(flag);
    if (flag === "--json" || flag === "--working-tree") continue;
    if (flag !== "--base" && flag !== "--head") {
      throw new Error(`Unknown option ${JSON.stringify(flag)}. See --help.`);
    }

    const ref = flags.next().value;
    if (!ref || ref.startsWith("-")) throw new Error(`${flag} requires a Git ref.`);
    if (flag === "--base") base = ref;
    else head = ref;
  }

  const json = seen.has("--json");
  if (command === "validate" && seen.has("--working-tree") && !base && !head) return { kind: "working-tree", json };
  if (!seen.has("--working-tree") && base && head) return { kind: "git", command, json, base, head };
  if (command === "impact") throw new Error("Impact requires both --base and --head. See --help.");
  throw new Error("Specify --working-tree or both --base and --head. See --help.");
}

type Source = { kind: "working-tree" } | { kind: "git"; base: string; head: string };

async function reportVault(files: ReadonlyMap<string, string>, source: Source, json: boolean) {
  const { validateVault } = await import("@nutshell/core/vault");
  const issues = validateVault(files);
  if (json) {
    console.log(JSON.stringify({ scope: "vault-snapshot", source, issues }, null, 2));
  } else {
    const location = source.kind === "git" ? `head ${source.head} (base ${source.base})` : "the working tree";
    console.log(`Vault snapshot checks for ${location}`);
    for (const issue of issues) console.log(`${issue.path} [${issue.code}] ${issue.message}`);
    console.log(issues.length === 0 ? "Passed." : `${issues.length} issue(s).`);
  }
  return issues.length === 0 ? 0 : 1;
}

async function reportGitComparison(options: Extract<Options, { kind: "git" }>, cwd: string) {
  const { hasOnlyHistoricalReferenceIssues, readGitComparison, readLocalChangeHistory } = await import("./git-comparison.ts");
  const comparison = await readGitComparison(cwd, options.base, options.head, options.command === "validate");
  const { source } = comparison;
  if (comparison.kind === "vault") return reportVault(comparison.files, source, options.json);

  const { validateRepositoryChanges } = await import("@nutshell/core/change-validation");
  const { baseFiles, headFiles, changedPaths } = comparison;
  let report = validateRepositoryChanges({ baseFiles, headFiles, changedPaths });
  if (!report.ok && report.issues.every(({ message }) => message.startsWith("Invalid base snapshot. ")) &&
      hasOnlyHistoricalReferenceIssues(report.issues)) {
    const history = await readLocalChangeHistory(cwd, source.base);
    if (history.ok) report = validateRepositoryChanges({ baseFiles, headFiles, changedPaths, acceptedChanges: history.acceptedChanges });
  }
  if (options.json) {
    const scope = options.command === "impact" ? "repository-impact" : "repository-change-validation";
    console.log(JSON.stringify({ scope, source, ...report }, null, 2));
  } else {
    const heading = options.command === "impact" ? "Repository impact" : "Repository change checks";
    console.log(`${heading} for head ${source.head} (base ${source.base}, policy ${report.policyVersion})`);
    if (options.command === "impact") {
      if (report.mappings.length === 0) console.log("No changed paths.");
      for (const { path, covered, entityIds, changeIds, memoryPaths } of report.mappings) {
        const coverage = covered ? "covered" : "outside coverage";
        console.log(`${JSON.stringify(path)} [${coverage}]`);
        if (entityIds.length) console.log(`  Entities ${entityIds.join(", ")}`);
        if (changeIds.length) console.log(`  Changes ${changeIds.join(", ")}`);
        if (memoryPaths.length) console.log(`  Memory ${memoryPaths.map((note) => JSON.stringify(note)).join(", ")}`);
      }
    }
    for (const issue of report.issues) console.log(`${JSON.stringify(issue.path)} [${issue.severity} ${issue.code}] ${issue.message}`);
    console.log(report.issues.length === 0 ? "Passed." : `${report.issues.length} issue(s).`);
  }
  return report.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args[0] === "init") {
    const { runInitCommand } = await import("./init-command.ts");
    return runInitCommand(args.slice(1), process.cwd());
  }
  if (args[0] === "change") {
    const { runChangeCommand } = await import("./change-command.ts");
    return runChangeCommand(args.slice(1), process.cwd());
  }
  if (args[0] === "context") {
    const { runContextCommand } = await import("./context-command.ts");
    return runContextCommand(args.slice(1), process.cwd());
  }
  const options = parseOptions(args);
  if (options.kind === "help") {
    console.log(help);
    return 0;
  }

  if (options.kind === "git") return reportGitComparison(options, process.cwd());
  const { readWorkingTree } = await import("./vault-files.ts");
  const snapshot = readWorkingTree(process.cwd());
  return reportVault(snapshot.files, { kind: snapshot.kind }, options.json);
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`nutshell: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
