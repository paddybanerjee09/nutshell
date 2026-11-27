import { buildRepositorySetupTree } from "@nutshell/core/fixture-setup-tree";
import { applyAuthoringEdits, missingAuthoringDirectories, readAuthoringTree } from "./authoring-files.ts";

const help = `Usage:
  pnpm nutshell init [--write] [--json]

Preview Nutshell repository setup in the current directory. Add --write to create
the missing files and directories and append the managed AGENTS.md section.`;

const vaultDirectories = ["nutshell-vault/archive", "nutshell-vault/decisions"];
const setupDetails = {
  name: "Repository",
  description: "Source code and project documentation for this repository.",
  entityId: "ent_nutshell_repository",
};

function parseOptions(args: readonly string[]) {
  const seen = new Set<string>();
  for (const flag of args) {
    if (seen.has(flag)) throw new Error(`Repeated option ${JSON.stringify(flag)}.`);
    if (flag !== "--write" && flag !== "--json") {
      throw new Error(`Unknown init option ${JSON.stringify(flag)}. See init --help.`);
    }
    seen.add(flag);
  }
  return { write: seen.has("--write"), json: seen.has("--json") };
}

export function runInitCommand(args: readonly string[], cwd: string): number {
  if (args.length === 1 && args[0] === "--help") {
    console.log(help);
    return 0;
  }
  const { write, json } = parseOptions(args);
  const existing = readAuthoringTree(cwd);
  const directories = missingAuthoringDirectories(cwd, vaultDirectories);
  const today = new Date().toISOString().slice(0, 10);
  const proposed = buildRepositorySetupTree(
    [...existing].map(([path, body]) => ({ path, body })), setupDetails, "local", today,
  );
  const edits = proposed.flatMap(({ path, body }) => {
    const previousBody = existing.get(path);
    if (previousBody === body) return [];
    return [{ path, body, previousBody }];
  });

  const changed = edits.length > 0 || directories.length > 0;
  if (write && changed) applyAuthoringEdits(cwd, edits, directories);

  const files = edits.map(({ path, previousBody }) => ({
    path, action: previousBody === undefined ? "create" : "append",
  }));
  if (json) {
    console.log(JSON.stringify({
      scope: "repository-init",
      mode: write ? "write" : "preview",
      status: changed ? (write ? "written" : "planned") : "configured",
      files,
      directories,
    }, null, 2));
  } else if (changed) {
    console.log(write ? "Nutshell initialized in the working tree." : "Nutshell setup preview");
    for (const { path, action } of files) console.log(`${action === "append" ? "Append" : "Create"} ${path}`);
    for (const directory of directories) console.log(`Create directory ${directory}`);
    if (!write) console.log("Run with --write to apply this setup.");
  } else {
    console.log("Nutshell is already configured.");
  }
  return 0;
}
