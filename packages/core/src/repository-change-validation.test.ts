import { describe, expect, it } from "vitest";
import { buildFixtureSetupTree } from "./fixture-setup-tree.ts";
import { repositoryChangeSchema, repositoryConfigSchema, repositoryEntitySchema, type RepositoryChange } from "./repo-snapshot.ts";
import { validateRepositoryChanges, type RepositoryChangeValidationResult } from "./repository-change-validation.ts";

const configPath = ".nutshell/config.json";
const entityId = "ent_capture";
const entityPath = `.nutshell/entities/${entityId}.json`;
const memoryPath = "nutshell-vault/features/nutshell-setup/CONTEXT.md";
const indexPath = "nutshell-vault/_INDEX.md";
const recordPath = (id: string) => `.nutshell/changes/${id}.json`;
const originalId = "chg_nutshell_setup";
const trackedCode = "src/capture/first.ts";
const details = { name: "Capture fixture", description: "Test the captured field observations.", entityId };

function setup(files: ReadonlyMap<string, string>) {
  return new Map(buildFixtureSetupTree([...files].map(([path, body]) => ({ path, body })), details).map(({ path, body }) => [path, body]));
}

function fixture() {
  const files = setup(new Map([[trackedCode, "prior source"]]));
  const entity = repositoryEntitySchema.parse(JSON.parse(files.get(entityPath)!));
  files.set(entityPath, JSON.stringify({ ...entity, code_paths: ["src/capture/**"] }));
  return files;
}

function coverage(files: Map<string, string>, include: string[], exclude: string[] = []) {
  const current = repositoryConfigSchema.parse(JSON.parse(files.get(configPath)!));
  files.set(configPath, JSON.stringify({ ...current, coverage: { include, exclude } }));
}

function addChange(files: Map<string, string>, changes: Partial<RepositoryChange> = {}) {
  const record: RepositoryChange = { schema_version: 1, id: "chg_candidate", entity_ids: [entityId], change_type: "fixed",
    summary: "Correct the field capture behavior.", product_impact: "user_visible", rationale: "Preserve the original recorded location.",
    technical_summary: "Retain the saved coordinates during validation.", memory_paths: [memoryPath], evidence: [], ...changes };
  files.set(recordPath(record.id), JSON.stringify(record));
  return record;
}

function diff(base: ReadonlyMap<string, string>, head: ReadonlyMap<string, string>) {
  return [...new Set([...base.keys(), ...head.keys()])].filter((path) => base.get(path) !== head.get(path));
}

function validate(baseFiles: ReadonlyMap<string, string>, headFiles: ReadonlyMap<string, string>, acceptedChanges?: ReadonlyMap<string, RepositoryChange>) {
  return validateRepositoryChanges({ baseFiles, headFiles, changedPaths: diff(baseFiles, headFiles), acceptedChanges });
}

function mapping(result: RepositoryChangeValidationResult, path: string) {
  return result.mappings.find((entry) => entry.path === path);
}

describe("trusted repository change validation", () => {
  it("maps literal changed source to affected entities, current memory and a fresh declaration", () => {
    const base = fixture();
    const head = new Map(base);
    head.set(trackedCode, "new source");
    const record = addChange(head);
    const result = validate(base, head);
    expect(result).toMatchObject({ ok: true, policyVersion: 1, issues: [] });
    expect(mapping(result, trackedCode)).toEqual({ path: trackedCode, covered: true, entityIds: [entityId], memoryPaths: [memoryPath], changeIds: [record.id] });
    expect(validateRepositoryChanges({ baseFiles: new Map([...base].reverse()), headFiles: new Map([...head].reverse()),
      changedPaths: [...diff(base, head).reverse(), trackedCode] })).toEqual(result);
  });

  it("retains base coverage and rejects new exclusions or removal of trusted includes", () => {
    const base = fixture();
    const head = new Map(base);
    coverage(head, [], ["src/**"]);
    head.set(trackedCode, "code the candidate tries to omit");
    const result = validate(base, head);
    expect(result.ok).toBe(false);
    expect(result.issues.filter(({ code }) => code === "policy-weakening")).toHaveLength(2);
    expect(result.issues).toContainEqual(expect.objectContaining({ path: trackedCode, code: "covered-undeclared", severity: "error" }));
    expect(mapping(result, trackedCode)?.covered).toBe(true);
  });

  it("accepts provable broader includes, redundant exclusions, and new exclusions outside old literal roots", () => {
    const base = fixture();
    coverage(base, ["src/capture/*.ts"], ["src/capture/generated/**"]);
    const head = new Map(base);
    coverage(head, ["src/**", "app/**"], ["src/capture/generated/tmp/**", "app/legacy/**"]);
    head.set(trackedCode, "code requiring a declaration from base rules");
    addChange(head);
    expect(validate(base, head)).toMatchObject({ ok: true, issues: [] });
  });

  it("reports unmapped covered code and lets an explicit new entity-free no-impact declaration satisfy the gate", () => {
    const base = fixture();
    const head = new Map(base);
    const path = "src/unknown/worker.py";
    head.set(path, "unmapped source");
    expect(validate(base, head)).toMatchObject({ ok: false, issues: [{ path, code: "covered-unmapped", severity: "error" }] });
    addChange(head);
    expect(validate(base, head)).toMatchObject({ ok: false, issues: [{ path, code: "covered-unmapped", severity: "error" }] });
    const classified = addChange(head, { id: "chg_internal_cleanup", product_impact: "none", entity_ids: [], memory_paths: [] });
    const result = validate(base, head);
    expect(result).toMatchObject({ ok: true, issues: [{ path, code: "covered-unmapped", severity: "warning" }] });
    expect(mapping(result, path)?.changeIds).toEqual([classified.id]);
    const future = new Map(head);
    future.set(path, "a second uncovered change");
    expect(validate(head, future)).toMatchObject({ ok: false, issues: [{ path, code: "covered-unmapped", severity: "error" }] });
  });

  it.each(["N / A", "𠮷"])("rejects meaningless rationale %s even on a newly added explanatory record", (rationale) => {
    const base = fixture();
    const head = new Map(base);
    const path = "src/unknown/new.ts";
    head.set(path, "unmapped source");
    const record = addChange(head, { product_impact: "internal", entity_ids: [], memory_paths: [], rationale });
    expect(validate(base, head)).toMatchObject({ ok: false, issues: [
      { path: recordPath(record.id), code: "change-placeholder", severity: "error" }, { path, code: "covered-unmapped", severity: "error" },
    ] });
  });

  it("maps both rename endpoints using base and head entities and keeps removed entity IDs", () => {
    const base = fixture();
    const head = new Map(base);
    const newPath = "src/moved/second.ts";
    head.delete(trackedCode);
    head.set(newPath, "moved source");
    const old = repositoryEntitySchema.parse(JSON.parse(base.get(entityPath)!));
    head.set(entityPath, JSON.stringify({ ...old, title: "Moved capture", code_paths: ["src/moved/*.ts"] }));
    addChange(head, { change_type: "changed" });
    const result = validate(base, head);
    expect(result.ok).toBe(true);
    for (const path of [trackedCode, newPath]) expect(mapping(result, path)).toMatchObject({ entityIds: [entityId], memoryPaths: [memoryPath] });

    const removal = new Map(base);
    removal.delete(trackedCode);
    removal.set(entityPath, JSON.stringify({ ...old, lifecycle: "removed", code_paths: [] }));
    addChange(removal, { change_type: "removed" });
    expect(validate(base, removal).ok).toBe(true);
    expect(mapping(validate(base, removal), trackedCode)?.entityIds).toEqual([entityId]);
  });

  it.each(["planned", "removed"])("an introduced %s entity cannot classify covered code as mapped", (lifecycle) => {
    const base = fixture();
    const head = new Map(base);
    const path = "src/unknown/code.ts";
    const id = "ent_candidate";
    const blueprint = repositoryEntitySchema.parse(JSON.parse(base.get(entityPath)!));
    head.set(`.nutshell/entities/${id}.json`, JSON.stringify({ ...blueprint, id, code_paths: ["src/unknown/**"], lifecycle }));
    head.set(path, "modified source");
    addChange(head, { entity_ids: [id] });
    const result = validate(base, head);
    expect(result).toMatchObject({ ok: false, issues: [{ path, code: "covered-unmapped", severity: "error" }] });
    expect(mapping(result, path)?.entityIds).toEqual([]);
  });

  it("uses language-independent source coverage while bootstrapping instead of candidate exclusions", () => {
    const base = new Map([["README.md", "# Owner readme"], ["root.py", "prior source"]]);
    const head = setup(base);
    coverage(head, [], ["**"]);
    for (const path of ["root.py", "app/screen.kt", "lib/capture.go", "docs/guide.md", ".gitignore"]) head.set(path, "candidate change");
    const before = validate(base, head);
    expect(before.ok).toBe(false);
    for (const path of ["root.py", "app/screen.kt", "lib/capture.go"]) {
      expect(mapping(before, path)?.covered).toBe(true);
      expect(before.issues).toContainEqual(expect.objectContaining({ path, code: "covered-unmapped", severity: "error" }));
    }
    for (const path of ["docs/guide.md", ".gitignore"]) expect(mapping(before, path)?.covered).toBe(false);
    addChange(head, { entity_ids: [], product_impact: "internal", memory_paths: [] });
    expect(validate(base, head)).toMatchObject({ ok: true, issues: [
      { severity: "warning" }, { severity: "warning" }, { severity: "warning" },
    ] });
  });

  it("preserves prior records and refuses unsupported new corrections or reversals", () => {
    const base = fixture();
    const rewritten = new Map(base);
    const existing = repositoryChangeSchema.parse(JSON.parse(base.get(recordPath(originalId))!));
    rewritten.set(recordPath(originalId), JSON.stringify({ ...existing, summary: "Changed after publication." }));
    expect(validate(base, rewritten)).toMatchObject({ ok: false, issues: [{ code: "change-rewritten" }] });
    rewritten.delete(recordPath(originalId));
    expect(validate(base, rewritten)).toMatchObject({ ok: false, issues: [{ code: "change-removed" }] });

    const head = new Map(base);
    const newEvent = addChange(head);
    addChange(head, { id: "chg_correction", change_type: "corrected", corrects_change_id: newEvent.id });
    expect(validate(base, head)).toMatchObject({ ok: false, issues: [{ code: "change-correction" }] });
    addChange(head, { id: "chg_correction", change_type: "corrected", corrects_change_id: originalId });
    expect(validate(base, head).ok).toBe(true);
  });

  it("preserves trusted historical references across archive moves without relaxing validation of new links", () => {
    const base = fixture();
    const accepted = repositoryChangeSchema.parse(JSON.parse(base.get(recordPath(originalId))!));
    const archive = new Map(base);
    archive.set("nutshell-vault/archive/setup.md", archive.get(memoryPath)!.replace("status: active", "status: archived"));
    archive.delete(memoryPath);
    archive.set(indexPath, archive.get(indexPath)!.split("\n").filter((line) => !line.includes(`[${memoryPath}]`)).join("\n"));
    const entity = repositoryEntitySchema.parse(JSON.parse(archive.get(entityPath)!));
    archive.set(entityPath, JSON.stringify({ ...entity, memory_paths: [] }));
    expect(validate(base, archive).ok).toBe(true);

    const head = new Map(archive);
    addChange(head, { memory_paths: [], change_type: "reverted", reverses_change_id: originalId });
    expect(validate(archive, head)).toMatchObject({ ok: false, issues: [{ code: "memory-target" }] });
    const acceptedChanges = new Map([[originalId, accepted]]);
    expect(validate(archive, head, acceptedChanges).ok).toBe(true);
    addChange(head, { memory_paths: [memoryPath] });
    expect(validate(archive, head, acceptedChanges)).toMatchObject({ ok: false, issues: [{ code: "memory-target" }] });
  });

  it("fails closed on malformed authority, unsafe changed paths and a missing protected file delta", () => {
    const base = fixture();
    const head = new Map(base);
    head.set(configPath, "{}");
    expect(validateRepositoryChanges({ baseFiles: base, headFiles: head, changedPaths: ["src/../.git/config"] }).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "changed-path-invalid" }), expect.objectContaining({ code: "protected-change-missing" })]));
    expect(validateRepositoryChanges({ baseFiles: base, headFiles: base, changedPaths: [".nutshell/changes/absent.json"] }).issues)
      .toContainEqual(expect.objectContaining({ code: "protected-input-missing" }));
    expect(validateRepositoryChanges({ baseFiles: base, headFiles: base, changedPaths: ["src/absent.ts"] }).issues)
      .toContainEqual(expect.objectContaining({ code: "diff-path-unknown" }));
    const moved = new Map(base);
    moved.delete(trackedCode);
    moved.set("src/capture/second.ts", "moved source");
    expect(validateRepositoryChanges({ baseFiles: base, headFiles: moved, changedPaths: [] }).issues)
      .toMatchObject([{ path: trackedCode, code: "changed-path-missing" }, { path: "src/capture/second.ts", code: "changed-path-missing" }]);
    const malformedBase = new Map(base);
    malformedBase.set(configPath, "{}");
    const malformed = validate(malformedBase, base);
    expect(malformed.ok).toBe(false);
    expect(malformed.issues).toContainEqual(expect.objectContaining({
      path: configPath, code: "record-schema", message: expect.stringMatching(/^Invalid base snapshot/u),
    }));
  });

  it("fails closed for a comparison beyond the combined matching work budget", () => {
    const base = fixture();
    const blueprint = repositoryEntitySchema.parse(JSON.parse(base.get(entityPath)!));
    for (let entity = 0; entity < 430; entity++) {
      const id = `ent_limit_${entity}`;
      const code_paths = Array.from({ length: 8 }, (_, pattern) => `elsewhere/group${pattern}/**`);
      base.set(`.nutshell/entities/${id}.json`, JSON.stringify({ ...blueprint, id, code_paths }));
    }
    const head = new Map(base);
    for (let path = 0; path < 650; path++) head.set(`docs/unwatched-${path}.md`, "documentation");
    const result = validate(base, head);
    expect(result).toMatchObject({ ok: false, mappings: [], issues: [{ code: "mapping-limit", severity: "error" }] });
  });
});
