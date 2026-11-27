import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.ts";
import { projectRepositoryTree, repositoryEntitySchema, type RepositoryChange, type RepositoryProjection } from "./repo-snapshot.ts";
import { bootstrapRepositoryCoverage } from "./repository-change-validation.ts";

const root = "nutshell-vault/";
const catalogPath = root + "_INDEX.md";
const taskPath = root + "CURRENT_TASK.md";
const contextPath = root + "features/nutshell-setup/CONTEXT.md";
const noteTemplatePath = root + "templates/NOTE.md";
const taskTemplatePath = root + "templates/TASK.md";
const start = "<!-- nutshell:managed:start -->";
const finish = "<!-- nutshell:managed:end -->";
const managedInstructions = [
  start,
  "## Nutshell repository memory",
  "",
  "After reading the applicable owner instructions, read [the vault index](nutshell-vault/_INDEX.md), then [the current task](nutshell-vault/CURRENT_TASK.md), then only relevant indexed notes.",
  "Keep one lead-owned current task. Use a feature branch and PR. Confirm the matching merge before resetting the task through guarded cleanup.",
  "Treat `nutshell-vault/archive/` as historical. Update affected notes and their catalog entries with the work.",
  finish,
];

const setupDetails = z.strictObject({
  name: z.string().trim().min(1).max(160).regex(/^[^\p{Cc}]+$/u),
  description: z.string().trim().min(1).max(600).regex(/^[^\p{Cc}]+$/u),
  entityId: repositoryEntitySchema.shape.id,
});
const catalogMetadata = z.object({
  status: z.enum(["active", "planned", "accepted", "draft"]),
  tags: z.array(z.string()),
});

type SetupFile = { path: string; body: string };
type SetupDetails = z.input<typeof setupDetails>;
type SetupProvider = "fixture" | "github";

const setupCopy = {
  fixture: {
    tags: "setup, fixture",
    context: "This repository is a synthetic fixture for Nutshell's local setup flow.",
    consequences: "A simulated setup merge lets the local worker validate and publish this fixture's initial knowledge.",
    catalog: "The synthetic fixture setup context.",
    requirements: "This synthetic fixture exercises Nutshell's local repository setup.",
    rationale: "Give this synthetic fixture a versioned repository map and a shared vault.",
  },
  github: {
    tags: "setup, repository",
    context: "This repository uses Nutshell for source-linked knowledge.",
    consequences: "After the setup pull request merges, Nutshell validates the default-branch revision before indexing it.",
    catalog: "The Nutshell repository setup context.",
    requirements: "Record this repository's product and implementation requirements here.",
    rationale: "Give this repository a versioned product map and a shared vault.",
  },
} as const;

function installInstructions(owner: string) {
  const markers = owner.match(/<!--\s*nutshell\s*(?::\s*|[-\s]+)managed\b/giu);
  if (markers) {
    const lines = owner.replaceAll("\r\n", "\n").split("\n");
    const first = lines.indexOf(start);
    const last = lines.indexOf(finish);
    if (markers.length !== 2 || first < 0 || last <= first) {
      throw new Error("AGENTS.md has malformed or duplicate Nutshell markers. Resolve the managed section before retrying setup.");
    }
    if (lines.slice(first, last + 1).join("\n") !== managedInstructions.join("\n")) {
      throw new Error("AGENTS.md already has a different Nutshell managed section. Review that section before retrying setup.");
    }
    return owner;
  }

  const newline = owner.includes("\r\n") ? "\r\n" : "\n";
  let separator = "";
  if (owner && !owner.endsWith(newline + newline)) {
    separator = owner.endsWith(newline) ? newline : newline + newline;
  }
  return owner + separator + managedInstructions.join(newline) + newline;
}

type NoteSections = { context: string; decision: string; consequences: string; affectedFiles: string };

function memoryNote(id: string, tags: string, sections: NoteSections, extra = "") {
  return `---
id: ${id}
date: 2026-11-26
status: active
tags: [${tags}]
${extra}---

## Context

${sections.context}

## Decision

${sections.decision}

## Consequences

${sections.consequences}

## Affected files

${sections.affectedFiles}
`;
}

function initialVault(copy: (typeof setupCopy)[SetupProvider]) {
  return new Map([
    [taskPath, memoryNote("control-current-task", "control, task", {
      context: "No feature task is active.",
      decision: "The lead records the next feature here when work begins.",
      consequences: "Durable project guidance belongs in the indexed vault notes.",
      affectedFiles: "[Vault index](_INDEX.md)",
    }, `task_id: null
task_state: idle
task_revision: 0
repository_id: null
branch: null
base_branch: null
pr_number: null
pr_url: null
lead_agent: null
integration_checkout: null
last_verified_head: null
cleanup_pr_url: null
`)],
    [contextPath, memoryNote("feature-nutshell-setup", copy.tags, {
      context: copy.context,
      decision: "Keep repository instructions and handoff files with the project. Register active Markdown in one vault index.",
      consequences: copy.consequences,
      affectedFiles: "[Index](../../_INDEX.md), [current task](../../CURRENT_TASK.md), and [.nutshell configuration](../../../.nutshell/config.json).",
    })],
    [noteTemplatePath, memoryNote("template-note", "template, note", {
      context: "State why the note is needed. Give new notes a unique ID, an actual date, a lifecycle status, and relevant tags.",
      decision: "Record the concrete choice or current guidance.",
      consequences: "Record tradeoffs, verification, and follow-up. Archive superseded notes.",
      affectedFiles: "Name the affected paths and update [the index](../_INDEX.md).",
    })],
    [taskTemplatePath, memoryNote("template-current-task", "template, task", {
      context: "Describe the single active feature, its scope, and its lead.",
      decision: "Reuse the fields of [the current task](../CURRENT_TASK.md). Advance its revision on each overwrite and record the actual branch and PR.",
      consequences: "Record progress, checks and blockers. Clear the task only after confirming the matching merge and guarded cleanup.",
      affectedFiles: "Link the relevant indexed notes and concrete source paths.",
    })],
  ]);
}

const catalogDescriptions = new Map([
  ["AGENTS.md", "Owner instructions and the Nutshell reading order."],
  ["README.md", "Repository handoff."],
  ["SPEC.md", "Repository requirements."],
  [catalogPath, "The sole active memory catalog."],
  [taskPath, "The single lead-owned task."],
  [noteTemplatePath, "Four-section format for durable notes."],
  [taskTemplatePath, "Guidance for overwriting and clearing the current task."],
]);

function makeCatalog(files: ReadonlyMap<string, string>, contextDescription: string) {
  const rows = ["| Path | Description | Status | Tags |", "| --- | --- | --- | --- |"];
  for (const path of [...files.keys(), catalogPath].sort()) {
    const vaultDocument = path.startsWith(root) && /\.md$/iu.test(path) && !path.startsWith(root + "archive/");
    if (!vaultDocument && !catalogDescriptions.has(path)) continue;
    let status = "active";
    let tags = vaultDocument ? "control, index" : "handoff";
    if (vaultDocument && path !== catalogPath) {
      const body = files.get(path)!;
      if (body.length > 256 * 1024) throw new Error(path + " exceeds the managed document size limit.");
      const parsed = parseFrontmatter(body);
      const metadata = catalogMetadata.safeParse(parsed.ok ? parsed.data : undefined);
      if (!metadata.success) throw new Error("Fix the active note metadata in " + path + " before generating the vault index.");
      status = metadata.data.status;
      tags = metadata.data.tags.filter((tag) => /^[a-z0-9_-]+$/iu.test(tag)).slice(0, 4).join(", ") || "memory";
    }
    if (!path.isWellFormed()) throw new Error("Use valid Unicode in tracked file names before retrying setup.");
    const relative = vaultDocument ? path.slice(root.length) : "../" + path;
    const destination = relative.split("/").map(encodeURIComponent).join("/");
    const description = path === contextPath ? contextDescription : catalogDescriptions.get(path) ?? "Repository note.";
    rows.push(`| [${path}](<${destination}>) | ${description} | ${status} | ${tags} |`);
  }
  return memoryNote("control-vault-index", "control, index", {
    context: "Read this index before [the current task](CURRENT_TASK.md), then choose relevant notes.",
    decision: rows.join("\n"),
    consequences: "Keep one row per active managed Markdown file. Archive stays outside the active catalog.",
    affectedFiles: "The catalog above lists the managed files.",
  });
}

function addSetupRecords(files: Map<string, string>, details: SetupDetails, rationale: string) {
  const sourcePaths = [...files.keys()].some((path) => path.startsWith("src/")) ? ["src/**"] : [];
  const config: RepositoryProjection["config"] = {
    schema_version: 1,
    vault_root: "nutshell-vault",
    entity_kinds: [
      { slug: "feature", label: "Feature" },
      { slug: "screen", label: "Screen" },
      { slug: "service", label: "Service" },
      { slug: "module", label: "Module" },
    ],
    coverage: { include: [...bootstrapRepositoryCoverage.include], exclude: [...bootstrapRepositoryCoverage.exclude] },
  };
  const entity = repositoryEntitySchema.parse({
    schema_version: 1,
    id: details.entityId,
    kind: "module",
    title: details.name,
    summary: details.description,
    lifecycle: "active",
    code_paths: sourcePaths,
    memory_paths: [contextPath],
    relations: [],
  });
  const change: RepositoryChange = {
    schema_version: 1,
    id: "chg_nutshell_setup",
    entity_ids: [entity.id],
    change_type: "added",
    summary: "Initialized Nutshell repository knowledge for " + details.name + ".",
    product_impact: "internal",
    rationale,
    technical_summary: "Add the initial configuration, product entity and vault catalog through a setup proposal.",
    memory_paths: [contextPath],
    evidence: [],
  };
  for (const [path, record] of [
    [".nutshell/config.json", config],
    [".nutshell/entities/" + entity.id + ".json", entity],
    [".nutshell/changes/" + change.id + ".json", change],
  ] as const) {
    const body = JSON.stringify(record, null, 2) + "\n";
    if (files.has(path) && files.get(path) !== body) {
      throw new Error("Setup conflicts with the existing " + path + " record. Review that record before retrying setup.");
    }
    files.set(path, body);
  }
}

export function buildRepositorySetupTree(files: readonly SetupFile[], info: SetupDetails, provider: SetupProvider): SetupFile[] {
  const copy = setupCopy[provider];
  const details = setupDetails.safeParse(info);
  if (!details.success) throw new Error("Provide a valid repository name, description and stable entity ID before generating setup.");
  if (files.length > 5_000) throw new Error("The repository tree exceeds the path limit.");

  const tree = new Map<string, string>();
  for (const { path, body } of files) {
    if (tree.has(path)) throw new Error("The repository tree contains a duplicate path: " + path + ".");
    tree.set(path, body);
  }
  const owner = tree.get("AGENTS.md") ?? "";
  if (owner.length > 256 * 1024) throw new Error("AGENTS.md exceeds the managed document size limit.");
  tree.set("AGENTS.md", installInstructions(owner));
  if (!tree.has("README.md")) tree.set("README.md", "# Repository overview\n\nSee [the vault index](nutshell-vault/_INDEX.md) for shared repository knowledge.\n");
  if (!tree.has("SPEC.md")) tree.set("SPEC.md", "# Repository requirements\n\n" + copy.requirements + "\n");
  for (const [path, body] of initialVault(copy)) {
    if (!tree.has(path)) tree.set(path, body);
  }
  if (!tree.has(catalogPath)) tree.set(catalogPath, makeCatalog(tree, copy.catalog));
  addSetupRecords(tree, details.data, copy.rationale);

  for (const path of tree.keys()) {
    for (let separator = path.lastIndexOf("/"); separator > 0; separator = path.lastIndexOf("/", separator - 1)) {
      const parent = path.slice(0, separator);
      if (tree.has(parent)) throw new Error("Setup cannot place " + path + " beneath the existing file " + parent + ".");
    }
  }
  const projection = projectRepositoryTree(tree);
  if (!projection.ok) {
    const issue = projection.issues[0]!;
    throw new Error("Setup cannot use " + issue.path + ". " + issue.message);
  }
  return [...tree.keys()].sort().map((path) => ({ path, body: tree.get(path)! }));
}

export function buildFixtureSetupTree(files: readonly SetupFile[], info: SetupDetails): SetupFile[] {
  return buildRepositorySetupTree(files, info, "fixture");
}
