import { validateVault } from "@nutshell/core/vault";
import { readGitSnapshot, readWorkingTree } from "./vault-files.ts";

const help = `Usage:
  pnpm nutshell validate --working-tree [--json]
  pnpm nutshell validate --base <ref> --head <ref> [--json]

Validate the local vault snapshot. Git mode resolves both refs and validates
the vault at the resolved head. Scope: vault snapshot checks only.`;

type Options =
  | { kind: "help" }
  | { kind: "working-tree"; json: boolean }
  | { kind: "git"; json: boolean; base: string; head: string };

function parseOptions(args: string[]): Options {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    return { kind: "help" };
  }
  if (args[0] !== "validate") throw new Error("Expected the validate command. See --help.");
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
  if (seen.has("--working-tree") && !base && !head) return { kind: "working-tree", json };
  if (!seen.has("--working-tree") && base && head) return { kind: "git", json, base, head };
  throw new Error("Specify --working-tree or both --base and --head. See --help.");
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (options.kind === "help") {
    console.log(help);
    return 0;
  }

  const snapshot = options.kind === "git"
    ? await readGitSnapshot(process.cwd(), options.base, options.head)
    : readWorkingTree(process.cwd());
  const issues = validateVault(snapshot.files);
  const source = snapshot.kind === "git"
    ? { kind: snapshot.kind, base: snapshot.base, head: snapshot.head }
    : { kind: snapshot.kind };
  if (options.json) {
    console.log(JSON.stringify({ scope: "vault-snapshot", source, issues }, null, 2));
  } else {
    const location = source.kind === "git" ? `head ${source.head} (base ${source.base})` : "the working tree";
    console.log(`Vault snapshot checks for ${location}`);
    for (const issue of issues) console.log(`${issue.path} [${issue.code}] ${issue.message}`);
    console.log(issues.length === 0 ? "Passed." : `${issues.length} issue(s).`);
  }
  return issues.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`nutshell: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
