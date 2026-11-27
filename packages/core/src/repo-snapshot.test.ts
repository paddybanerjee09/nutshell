import { describe, expect, it } from "vitest";
import { projectRepositoryTree, type RepositoryChange, type RepositoryEntity } from "./repo-snapshot.ts";

const configPath = ".nutshell/config.json";
const indexPath = "nutshell-vault/_INDEX.md";
const taskPath = "nutshell-vault/CURRENT_TASK.md";
const memoryPath = "nutshell-vault/features/welcome/CONTEXT.md";
const archivePath = "nutshell-vault/archive/welcome.md";
const config = {
  schema_version: 1,
  vault_root: "nutshell-vault",
  entity_kinds: ["feature", "screen", "service", "module", "level"].map((slug) => ({ slug, label: slug })),
  coverage: { include: ["src/**"], exclude: ["src/generated/**"] },
};
const entity = {
  schema_version: 1,
  id: "ent_welcome",
  kind: "level",
  title: "Welcome stage",
  summary: "Introduce players to the workshop.",
  lifecycle: "active",
  code_paths: ["src/welcome/*.ts"],
  memory_paths: [memoryPath],
  relations: [],
} satisfies RepositoryEntity;
const change = {
  schema_version: 1,
  id: "chg_welcome",
  entity_ids: [entity.id],
  change_type: "added",
  summary: "Added the welcome stage.",
  product_impact: "user_visible",
  rationale: "Introduce the workshop before assigning a project.",
  technical_summary: "Display the welcome stage before the project list.",
  memory_paths: [memoryPath],
  evidence: [],
} satisfies RepositoryChange;

function note(id: string, section = "", status = "active") {
  return [
    "---", "id: " + id, "date: 2026-11-26", "status: " + status, "tags: [memory]", "---", "",
    "## Context", "", "## Decision", "", section, "", "## Consequences", "", "## Affected files", "",
  ].join("\n");
}

function fixture() {
  const catalog = [
    "| Path | Description | Status | Tags |",
    "| --- | --- | --- | --- |",
    ...["AGENTS.md", "README.md", "SPEC.md", indexPath, taskPath, memoryPath].map((path) => {
      const destination = path.startsWith("nutshell-vault/") ? path.slice("nutshell-vault/".length) : "../" + path;
      return `| [${path}](${destination}) | Fixture knowledge. | active | memory |`;
    }),
  ].join("\n");

  return new Map([
    [configPath, JSON.stringify(config)],
    [".nutshell/entities/" + entity.id + ".json", JSON.stringify(entity)],
    [".nutshell/changes/" + change.id + ".json", JSON.stringify(change)],
    [memoryPath, note("welcome")],
    [indexPath, note("index", catalog)],
    [taskPath, note("task")],
    [archivePath, note("archived", "", "archived")],
    ["src/welcome/index.ts", "// Visible source path"],
    ["AGENTS.md", "# Agent instructions"],
    ["README.md", "# Setup"],
    ["SPEC.md", "# Requirements"],
  ]);
}

function codes(files: ReadonlyMap<string, string>) {
  const result = projectRepositoryTree(files);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map(({ code }) => code);
}

describe("repository projection", () => {
  it("preserves declared records and projects a deterministic active vault from a single immutable tree", () => {
    const files = fixture();
    const result = projectRepositoryTree(files);
    expect(result).toEqual({ ok: true, snapshot: {
      config, entities: [entity], changes: [change], documents: [taskPath, indexPath, memoryPath].map((path) => ({
        path, markdown: files.get(path),
      })),
    } });
    expect(projectRepositoryTree(new Map([...files].reverse()))).toEqual(result);
  });

  it("rejects unsupported schema versions, unknown fields, invalid JSON, and unregistered or duplicate kinds", () => {
    const files = fixture();
    files.set(configPath, JSON.stringify({ ...config, schema_version: 2 }));
    files.set(".nutshell/changes/" + change.id + ".json", "{");
    files.set(".nutshell/entities/" + entity.id + ".json", JSON.stringify({ ...entity, author: "Untrusted" }));
    expect(codes(files)).toEqual(["record-json", "record-schema", "record-schema"]);

    const next = fixture();
    next.set(configPath, JSON.stringify({ ...config, entity_kinds: [...config.entity_kinds.slice(0, 3), config.entity_kinds[0]] }));
    expect(codes(next)).toEqual(["entity-kinds", "entity-kind"]);
  });

  it("rejects misplaced records and mismatched or duplicate IDs", () => {
    const files = fixture();
    files.set(".nutshell/memory.md", "# Misplaced note");
    files.set(".nutshell/entities/wrong.json", JSON.stringify(entity));
    expect(codes(files)).toEqual(["record-filename", "record-duplicate", "record-path"]);
  });

  it.each(["/absolute.ts", "C:/src/file.ts", "src/../file.ts", "src\\file.ts", "src/.GIT/config", "src/evil\0.txt", "src/%2e%2e/outside"])(
    "rejects unsafe repository path %s",
    (path) => {
      const files = fixture();
      files.set(path, "repository input");
      expect(codes(files)).toEqual(["tree-path"]);
    },
  );

  it("rejects malformed globs, wildcard links, and memory links to inactive or missing documents", () => {
    const files = fixture();
    files.set(configPath, JSON.stringify({ ...config, coverage: { include: ["src/a**b"], exclude: ["src/{a,b}"] } }));
    files.set(".nutshell/entities/" + entity.id + ".json", JSON.stringify({ ...entity, memory_paths: ["nutshell-vault/*.md"] }));
    expect(codes(files)).toEqual(["record-schema", "record-schema", "record-schema"]);

    const next = fixture();
    next.set(".nutshell/changes/" + change.id + ".json", JSON.stringify({ ...change, memory_paths: [archivePath, "nutshell-vault/absent.md"] }));
    expect(codes(next)).toEqual(["memory-target", "memory-target"]);
  });

  it("requires an exhaustive valid vault and the root handoff files", () => {
    const files = fixture();
    files.delete("AGENTS.md");
    files.delete(taskPath);
    files.set(memoryPath, "# Missing frontmatter");
    expect(codes(files)).toEqual(expect.arrayContaining(["handoff-missing", "control-missing", "note-frontmatter", "index-unmanaged"]));
  });

  it("checks same-repository targets and rejects a part-of cycle while allowing dependency cycles", () => {
    const files = fixture();
    const related = "ent_first_stage";
    files.set(".nutshell/entities/" + entity.id + ".json", JSON.stringify({
      ...entity, relations: [{ type: "depends_on", target: related }],
    }));
    files.set(".nutshell/entities/" + related + ".json", JSON.stringify({
      ...entity, id: related, relations: [{ type: "depends_on", target: entity.id }],
    }));
    expect(projectRepositoryTree(files).ok).toBe(true);
    files.set(".nutshell/entities/" + entity.id + ".json", JSON.stringify({
      ...entity, relations: [{ type: "part_of", target: related }, { type: "depends_on", target: "ent_other_repository" }],
    }));
    files.set(".nutshell/entities/" + related + ".json", JSON.stringify({
      ...entity, id: related, relations: [{ type: "part_of", target: entity.id }],
    }));
    expect(codes(files)).toEqual(["entity-target", "part-of-cycle"]);
  });

  it("checks declared changes without treating screenshot metadata as observed media", () => {
    const files = fixture();
    const screenshot = {
      kind: "screenshot", asset_id: "asset_welcome", source_revision: "f".repeat(64), route: "/welcome",
      state: "empty", viewport: { width: 1440, height: 900 }, environment: "local-alpha", captured_at: "2026-11-26T12:00:00Z",
    };
    files.set(".nutshell/changes/" + change.id + ".json", JSON.stringify({ ...change, evidence: [screenshot] }));
    const result = projectRepositoryTree(files);
    expect(result.ok && result.snapshot.changes[0]?.evidence).toEqual([screenshot]);
    files.set(".nutshell/changes/" + change.id + ".json", JSON.stringify({ ...change, evidence: [
      { ...screenshot, route: "https://example.org/welcome", source_revision: "deadbeef" },
    ] }));
    expect(codes(files)).toEqual(["record-schema", "record-schema"]);

    const next = fixture();
    next.set(".nutshell/changes/" + change.id + ".json", JSON.stringify({
      ...change, entity_ids: [], change_type: "corrected", reverses_change_id: change.id,
    }));
    expect(codes(next)).toEqual(["change-impact", "change-reversal", "change-correction"]);
    next.set(".nutshell/changes/" + change.id + ".json", JSON.stringify(change));
    next.set(".nutshell/changes/reversal.json", JSON.stringify({
      ...change, id: "reversal", change_type: "reverted", reverses_change_id: change.id,
    }));
    expect(projectRepositoryTree(next).ok).toBe(true);
  });

  it("rejects oversized managed input before JSON or Markdown parsing", () => {
    const files = fixture();
    files.set(configPath, "\n".repeat(256 * 1024 + 1));
    expect(codes(files)).toEqual(["file-size"]);
    expect(codes(new Map(Array.from({ length: 5_001 }, (_, index) => [`src/${index}.ts`, ""])))).toEqual(["tree-size"]);
  });
});
