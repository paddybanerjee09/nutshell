import type { VaultContextResult } from "@nutshell/core/context-retrieval";

const contextUsage = `  pnpm nutshell context --query <text> [--paths <path,path>] [--budget <estimated tokens>]
                           [--ref <ref> | --working-tree] [--include-archive] [--json]`;

const contextHelp = `Usage:\n${contextUsage}

Retrieve ranked repository memory from Git HEAD, an explicit Git ref, or the working tree.
Supply a query, repository-relative paths, or both. The default budget is 8192 estimated tokens.`;

type ContextOptions = {
  query: string;
  paths: string[];
  budget: number;
  ref: string;
  workingTree: boolean;
  includeArchive: boolean;
  json: boolean;
};

function repositoryPaths(value: string) {
  const paths = value.split(",").map((path) => path.trim());
  if (paths.length > 32 || paths.some((path) => !path || Buffer.byteLength(path) > 512 ||
    /[\\:*?<>|\p{Cc}]|%(?:00|2e|2f|5c)/iu.test(path) ||
    path.split("/").some((part) => !part || /[. ]$/u.test(part)))) {
    throw new Error("--paths requires up to 32 comma-separated repository-relative paths.");
  }
  return [...new Set(paths)];
}

function parseContextOptions(args: readonly string[]): ContextOptions {
  const seen = new Set<string>();
  let query = "";
  let paths: string[] = [];
  let budget = 8192;
  let ref = "HEAD";
  const flags = args.values();
  for (const flag of flags) {
    if (seen.has(flag)) throw new Error(`Repeated option ${JSON.stringify(flag)}.`);
    seen.add(flag);
    if (flag === "--working-tree" || flag === "--include-archive" || flag === "--json") continue;
    if (flag !== "--query" && flag !== "--paths" && flag !== "--budget" && flag !== "--ref") {
      throw new Error(`Unknown context option ${JSON.stringify(flag)}. See context --help.`);
    }
    const value = flags.next().value;
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
    switch (flag) {
      case "--query":
        if (!value.trim() || Buffer.byteLength(value) > 1024) throw new Error("--query requires up to 1024 bytes of text.");
        query = value.trim();
        break;
      case "--paths":
        paths = repositoryPaths(value);
        break;
      case "--budget":
        if (!/^[1-9]\d{0,4}$/u.test(value)) throw new Error("--budget requires a positive estimated token count.");
        budget = Number(value);
        break;
      case "--ref":
        ref = value;
        break;
    }
  }
  const workingTree = seen.has("--working-tree");
  if (workingTree && seen.has("--ref")) throw new Error("Choose either --ref or --working-tree.");
  if (!query && paths.length === 0) throw new Error("Specify --query, --paths, or both. See context --help.");
  return { query, paths, budget, ref, workingTree, includeArchive: seen.has("--include-archive"), json: seen.has("--json") };
}

function printContext(result: VaultContextResult) {
  const { source, budget } = result;
  const location = source.kind === "git" ? source.revision : "the working tree";
  console.log(`Vault context at ${location}`);
  console.log(`Budget ${budget.used}/${budget.limit} estimated tokens. ${budget.requiredControlTokens} required for controls.`);
  for (const control of result.controls) {
    console.log(`\n## ${control.path}\nMandatory control\n\n${control.body}`);
  }
  for (const note of result.notes) {
    const headings = note.headings.length ? " · " + note.headings.join(" · ") : "";
    console.log(`\n## ${note.path}${headings}\n${note.reasons.join(". ")}\n\n${note.excerpt}`);
  }
  if (result.historical.length) {
    console.log("\n## Historical results");
    for (const note of result.historical) {
      console.log(`\n### ${note.path}\nLifecycle ${note.status}${note.replacement ? ` · Replacement ${note.replacement}` : ""}\n${note.reasons.join(". ")}\n\n${note.excerpt}`);
    }
  }
  for (const gap of result.gaps) console.log(`${gap.path ? `${gap.path} ` : ""}[${gap.code}] ${gap.message}`);
}

export async function runContextCommand(args: readonly string[], cwd: string): Promise<number> {
  if (args.length === 1 && args[0] === "--help") {
    console.log(contextHelp);
    return 0;
  }
  const { query, paths, budget, ref, workingTree, includeArchive, json } = parseContextOptions(args);
  const [{ retrieveVaultContext, vaultContextBudgetLimit }, { createContextSource }] = await Promise.all([
    import("@nutshell/core/context-retrieval"), import("./context-source.ts"),
  ]);
  if (budget > vaultContextBudgetLimit) throw new Error(`--budget must be between 1 and ${vaultContextBudgetLimit} estimated tokens.`);
  const source = await createContextSource(cwd, workingTree ? { kind: "working-tree" } : { kind: "git", ref });
  try {
    const result = await retrieveVaultContext(source, { query, paths, budget, includeArchive });
    if (json) console.log(JSON.stringify(result, null, 2));
    else printContext(result);
    return result.status === "invalid" ? 2 : 0;
  } finally {
    await source.close();
  }
}
