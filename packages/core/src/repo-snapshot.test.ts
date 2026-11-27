import { describe, expect, it } from "vitest";
import { canonicalRepositoryChange, projectRepositoryTree, type RepositoryChange, type RepositoryEntity } from "./repo-snapshot.ts";

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

function codes(files: ReadonlyMap<string, string>, acceptedChanges?: ReadonlyMap<string, RepositoryChange>) {
  const result = projectRepositoryTree(files, { acceptedChanges });
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

  it("matches accepted payloads across JSON key order while preserving array order", () => {
    const screenshot = {
      kind: "screenshot", asset_id: "asset_welcome", source_revision: "f".repeat(40), route: "/welcome",
      state: "empty", viewport: { width: 1440, height: 900 }, environment: "local-alpha", captured_at: "2026-11-26T12:00:00Z",
    } as const;
    const original: RepositoryChange = { ...change, evidence: [screenshot] };
    const reordered: RepositoryChange = { ...original, evidence: [{ ...screenshot, viewport: { height: 900, width: 1440 } }] };
    expect(canonicalRepositoryChange(reordered)).toBe(canonicalRepositoryChange(original));
    const additionalPath = "nutshell-vault/features/welcome/DETAILS.md";
    expect(canonicalRepositoryChange({ ...original, memory_paths: [additionalPath, memoryPath] }))
      .not.toBe(canonicalRepositoryChange({ ...original, memory_paths: [memoryPath, additionalPath] }));

    const files = fixture();
    const reorderedFile = JSON.stringify(Object.fromEntries(Object.entries(reordered).reverse()), null, 2);
    files.set(".nutshell/changes/" + change.id + ".json", "\n" + reorderedFile + "\n");
    expect(projectRepositoryTree(files, { acceptedChanges: new Map([[change.id, original]]) }).ok).toBe(true);
  });

  it("rejects deleting or rewriting an accepted record", () => {
    const files = fixture();
    const accepted = new Map([[change.id, change]]);
    const path = ".nutshell/changes/" + change.id + ".json";
    files.set(path, JSON.stringify({ ...change, summary: "Replaced the original narrative." }));
    expect(codes(files, accepted)).toEqual(["change-rewritten"]);
    files.delete(path);
    expect(codes(files, accepted)).toEqual(["change-removed"]);
  });

  it("retains exact accepted memory and entity references while requiring current links for new changes", () => {
    const files = fixture();
    const acceptedChanges = new Map([[change.id, change]]);
    const entityPath = ".nutshell/entities/" + entity.id + ".json";
    files.delete(memoryPath);
    files.set(archivePath, note("welcome", "", "archived"));
    const index = files.get(indexPath)!;
    files.set(indexPath, index.split("\n").filter((line) => !line.includes("[" + memoryPath + "]")).join("\n"));
    expect(codes(files, acceptedChanges)).toEqual(["memory-target"]);

    files.set(entityPath, JSON.stringify({ ...entity, title: "Workshop introduction", lifecycle: "removed", memory_paths: [] }));
    const renamed = projectRepositoryTree(files, { acceptedChanges });
    expect(renamed.ok && renamed.snapshot.changes).toEqual([change]);
    expect(renamed.ok && renamed.snapshot.documents.some(({ path }) => path === memoryPath)).toBe(false);

    files.delete(entityPath);
    expect(projectRepositoryTree(files, { acceptedChanges }).ok).toBe(true);
    expect(codes(files)).toEqual(["change-entity", "memory-target"]);

    const newId = "chg_new_event";
    files.set(".nutshell/changes/" + newId + ".json", JSON.stringify({ ...change, id: newId }));
    expect(codes(files, acceptedChanges)).toEqual(["change-entity", "memory-target"]);
  });

  it("requires distinct previously accepted correction and reversal targets when a baseline is known", () => {
    const files = fixture();
    const correction: RepositoryChange = { ...change, id: "chg_correction", change_type: "corrected", corrects_change_id: change.id };
    const reversal: RepositoryChange = { ...change, id: "chg_reversal", change_type: "reverted", reverses_change_id: change.id };
    const reversalPath = ".nutshell/changes/" + reversal.id + ".json";
    files.set(".nutshell/changes/" + correction.id + ".json", JSON.stringify(correction));
    files.set(reversalPath, JSON.stringify(reversal));
    const acceptedChanges = new Map<string, RepositoryChange>([[change.id, change]]);
    expect(projectRepositoryTree(files).ok).toBe(true);
    expect(codes(files, new Map())).toEqual(["change-correction", "change-reversal"]);
    expect(projectRepositoryTree(files, { acceptedChanges }).ok).toBe(true);

    files.set(reversalPath, JSON.stringify({ ...reversal, reverses_change_id: correction.id }));
    expect(codes(files, acceptedChanges)).toEqual(["change-reversal"]);
    acceptedChanges.set(correction.id, correction);
    expect(projectRepositoryTree(files, { acceptedChanges }).ok).toBe(true);

    files.set(reversalPath, JSON.stringify({ ...reversal, reverses_change_id: reversal.id }));
    expect(codes(files, acceptedChanges)).toEqual(["change-reversal"]);
  });

  it("rejects oversized managed input before JSON or Markdown parsing", () => {
    const files = fixture();
    files.set(configPath, "\n".repeat(256 * 1024 + 1));
    expect(codes(files)).toEqual(["file-size"]);
    expect(codes(new Map(Array.from({ length: 5_001 }, (_, index) => [`src/${index}.ts`, ""])))).toEqual(["tree-size"]);
  });
});
