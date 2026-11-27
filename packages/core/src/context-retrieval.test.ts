import { describe, expect, it } from "vitest";
import { retrieveVaultContext, type VaultContextRequest, type VaultContextSource } from "./context-retrieval.ts";

const index = "nutshell-vault/_INDEX.md";
const task = "nutshell-vault/CURRENT_TASK.md";
const credential = "nutshell-vault/features/auth/CONTEXT.md";
const decision = "nutshell-vault/decisions/2026-11-27-strategy.md";
const deeper = "nutshell-vault/workflows/deeper.md";
const unrelated = "nutshell-vault/workflows/unrelated.md";
const archived = "nutshell-vault/archive/retro-credentials.md";
const revision = "a".repeat(40);

function note(id: string, context: string, decision: string, status = "active", extra = "") {
  return `---\nid: ${id}\ndate: 2026-11-27\nstatus: ${status}\ntags: [memory]\n${extra}---\n\n## Context\n\n${context}\n\n## Decision\n\n${decision}\n\n## Consequences\n\nNone.\n\n## Affected files\n\nNone.\n`;
}

function row(path: string, description: string, status: string, tags: string) {
  const href = path.startsWith("nutshell-vault/") ? path.slice("nutshell-vault/".length) : "../" + path;
  return `| [${path}](${href}) | ${description} | ${status} | ${tags} |`;
}

function fixture() {
  const rows = [
    row(index, "Active catalog", "active", "index"), row(task, "Current task", "active", "task"),
    row("AGENTS.md", "Root instructions", "active", "handoff"), row("README.md", "Project setup", "active", "handoff"),
    row("SPEC.md", "Specification", "active", "handoff"), row(credential, "Credential rotation", "active", "security, rotation"),
    row(decision, "Recorded strategy", "accepted", "policy"), row(deeper, "Further procedure", "active", "policy"),
    row(unrelated, "Unrelated ledger", "planned", "evidence"),
  ];
  const catalog = ["| Path | Description | Status | Tags |", "| --- | --- | --- | --- |", ...rows].join("\n");
  return new Map([
    [index, note("index", "List entry information.", catalog)], [task, note("task", "Current task knowledge.", "Select context.")],
    ["AGENTS.md", "# Instructions"], ["README.md", "# Setup"], ["SPEC.md", "# Requirements"],
    [credential, note("auth", "Operations overview.", `Credential rotation applies here. See [the strategy](../../decisions/2026-11-27-strategy.md) and [a historical reference](../../archive/retro-credentials.md).`)],
    [decision, note("strategy", `Preserve decisions using [the deeper workflow](../workflows/deeper.md).`, "Accepted policy.", "accepted", "decision_key: strategy\n")],
    [deeper, note("deeper", "Second-hop body should never be loaded.", "Further workflow.")],
    [unrelated, note("unrelated", "Credential rotation is present only in the body.", "Unrelated text.", "planned")],
    [archived, note("historical", "The retro credentials procedure was superseded.", "Historical facts.", "superseded", `superseded_by: ${credential}\n`)],
  ]);
}

function source(files = fixture(), kind: VaultContextSource["kind"] = "git") {
  const operations: string[] = [];
  const reader: VaultContextSource = {
    kind, revision: kind === "git" ? revision : "working-tree",
    async listPaths(includeArchive) {
      operations.push(`list:${includeArchive}`);
      return [...files.keys()].filter((path) => includeArchive || !path.startsWith("nutshell-vault/archive/")).reverse();
    },
    async read(path) {
      operations.push(path);
      return files.get(path);
    },
  };
  return { reader, operations };
}

const request = { query: "credential rotation", paths: [], budget: 8192, includeArchive: false } satisfies VaultContextRequest;

describe("metadata-first vault context", () => {
  it("reads mandatory controls in order, ranks metadata and follows only one relevant hop", async () => {
    const files = fixture();
    const { reader, operations } = source(files);
    const result = await retrieveVaultContext(reader, request);
    expect(result.source).toEqual({ kind: "git", revision });
    expect(result.status).toBe("complete");
    expect(operations).toEqual([index, task, "list:false", credential, decision]);
    expect(result.controls).toEqual([{ path: index, body: files.get(index) }, { path: task, body: files.get(task) }]);
    expect(result.notes.map(({ path }) => path)).toEqual([credential, decision]);
    expect(result.notes[0]).toMatchObject({ headings: ["Decision"], reasons: expect.arrayContaining(["description matched credential, rotation"]) });
    expect(result.notes[0]?.excerpt).toContain("Credential rotation applies here.");
    expect(result.notes[0]?.excerpt).not.toContain("Operations overview.");
    expect(result.notes[1]?.reasons).toContain(`one-hop link from ${credential}`);
    expect(result.historical).toEqual([]);
  });

  it("matches exact paths and reports unmatched paths without scanning bodies", async () => {
    const { reader, operations } = source(undefined, "working-tree");
    const result = await retrieveVaultContext(reader, { ...request, query: "", paths: [unrelated, "src/unmatchable.cs"] });
    expect(result.source).toEqual({ kind: "working-tree", revision: "working-tree" });
    expect(result.status).toBe("partial");
    expect(result.notes[0]).toMatchObject({ path: unrelated, reasons: [`exact path ${unrelated}`] });
    expect(operations).toEqual([index, task, "list:false", unrelated]);
    expect(result.gaps).toContainEqual(expect.objectContaining({ path: "src/unmatchable.cs", code: "path-unmatched" }));
  });

  it("reports no evidence when only an unselected body matches", async () => {
    const { reader, operations } = source();
    const result = await retrieveVaultContext(reader, { ...request, query: "overview" });
    expect(result.status).toBe("no_match");
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: "no-match" }));
    expect(operations).toEqual([index, task, "list:false"]);
  });

  it("keeps explicit historical results separate and reports replacement metadata", async () => {
    const { reader, operations } = source();
    const result = await retrieveVaultContext(reader, { ...request, query: "retro credentials", includeArchive: true });
    expect(operations).toEqual([index, task, "list:true", archived]);
    expect(result.notes).toEqual([]);
    expect(result.historical).toEqual([expect.objectContaining({ path: archived, historical: true, status: "superseded", replacement: credential })]);
  });

  it("prioritizes matched current guidance and its decision links over explicit historical paths", async () => {
    const files = fixture();
    const { reader, operations } = source(files);
    const required = Math.ceil((Buffer.byteLength(files.get(index)!) + Buffer.byteLength(files.get(task)!)) / 4);
    const result = await retrieveVaultContext(reader, { ...request, budget: required + 77, paths: [archived], includeArchive: true });
    expect(result.notes.map(({ path }) => path)).toEqual([credential, decision]);
    expect(operations.slice(0, 5)).toEqual([index, task, "list:true", credential, decision]);
    expect(result.budget.used).toBeLessThanOrEqual(required + 77);
  });

  it("reports ambiguous wikilinks without guessing a target or reading extra bodies", async () => {
    const files = fixture();
    const left = "nutshell-vault/workflows/Guide.md";
    const right = "nutshell-vault/architecture/Guide.md";
    const additions = [row(left, "First guide", "accepted", "policy"), row(right, "Second guide", "accepted", "policy")].join("\n");
    files.set(index, files.get(index)!.replace("\n\n## Consequences", `\n${additions}\n\n## Consequences`));
    files.set(credential, note("auth", "Overview.", "Credential rotation uses [[Guide|the guide]]."));
    files.set(left, note("left", "Left policy.", "Read it.", "accepted"));
    files.set(right, note("right", "Right policy.", "Read it.", "accepted"));
    const { reader, operations } = source(files);
    const result = await retrieveVaultContext(reader, request);
    expect(operations).toEqual([index, task, "list:false", credential]);
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: "ambiguous-link", path: credential }));
  });
});

describe("catalog and token bounds", () => {
  it("rejects a missing control and still attempts both controls in order", async () => {
    const files = fixture();
    files.delete(index);
    const { reader, operations } = source(files);
    const result = await retrieveVaultContext(reader, request);
    expect(result.status).toBe("invalid");
    expect(result.gaps).toContainEqual(expect.objectContaining({ path: index, code: "control-missing" }));
    expect(operations).toEqual([index, task]);
  });

  for (const issue of ["index-missing", "index-stale", "index-duplicate"] as const) {
    it(`reports ${issue} before optional reads`, async () => {
      const files = fixture();
      const entry = row(credential, "Credential rotation", "active", "security, rotation");
      if (issue === "index-missing") files.set(index, files.get(index)!.replace(entry + "\n", ""));
      if (issue === "index-stale") files.delete(credential);
      if (issue === "index-duplicate") files.set(index, files.get(index)!.replace(entry, entry + "\n" + entry));
      const { reader, operations } = source(files);
      const result = await retrieveVaultContext(reader, request);
      expect(result.status).toBe("invalid");
      expect(result.gaps).toContainEqual(expect.objectContaining({ code: issue }));
      expect(operations.filter((operation) => !operation.startsWith("list:"))).toEqual([index, task]);
    });
  }

  it("enforces the shared estimated-token budget without truncating the controls or breaking Unicode", async () => {
    const files = fixture();
    const required = Math.ceil((Buffer.byteLength(files.get(index)!) + Buffer.byteLength(files.get(task)!)) / 4);
    files.set(credential, note("auth", "Overview.", "Credential rotation. " + "漢😀".repeat(100)));
    const tooSmall = source(files);
    const invalid = await retrieveVaultContext(tooSmall.reader, { ...request, budget: required - 1 });
    expect(invalid.controls).toEqual([]);
    expect(invalid.budget.requiredControlTokens).toBe(required);
    expect(invalid.gaps).toContainEqual(expect.objectContaining({ code: "control-budget" }));
    expect(tooSmall.operations).toEqual([index, task]);

    const fitting = source(files);
    const limit = required + 16;
    const limited = await retrieveVaultContext(fitting.reader, { ...request, budget: limit });
    expect(limited.status).toBe("partial");
    expect(limited.gaps).toContainEqual(expect.objectContaining({ code: "budget-limited" }));
    expect(limited.controls.map(({ body }) => body)).toEqual([files.get(index), files.get(task)]);
    const excerpt = limited.notes[0]!.excerpt;
    expect(limited.notes[0]?.truncated).toBe(true);
    expect(excerpt).not.toContain("�");
    expect(excerpt.isWellFormed()).toBe(true);
    expect(limited.budget.used).toBe(Math.ceil(limited.controls.reduce((sum, control) => sum + Buffer.byteLength(control.body), Buffer.byteLength(excerpt)) / 4));
    expect(limited.budget.used).toBeLessThanOrEqual(limit);
    expect(fitting.operations).toEqual([index, task, "list:false", credential]);
  });

  it("rejects unsafe requested paths without accessing a source", async () => {
    const { reader, operations } = source();
    const result = await retrieveVaultContext(reader, { ...request, paths: ["../note.md"] });
    expect(result.status).toBe("invalid");
    expect(result.gaps).toContainEqual(expect.objectContaining({ code: "invalid-request" }));
    expect(operations).toEqual([]);
  });
});
