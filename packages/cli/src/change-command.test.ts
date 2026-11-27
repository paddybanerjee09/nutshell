import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateRepositoryChanges } from "@nutshell/core/change-validation";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import { repositoryConfigSchema } from "@nutshell/core/snapshot";
import { expect, onTestFinished, test, vi } from "vitest";
import { runChangeCommand } from "./change-command.ts";

const entity = "ent_field_log";
const original = "chg_nutshell_setup";
const change = "chg_field_log_fix";
const memory = "nutshell-vault/features/nutshell-setup/CONTEXT.md";
const config = ".nutshell/config.json";
const record = (id: string) => `.nutshell/changes/${id}.json`;

function scratch(options: { coverRecords?: boolean; archivedMemory?: boolean } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "nutshell-change-command-"));
  onTestFinished(() => rmSync(cwd, { recursive: true, force: true }));
  const files = new Map(buildFixtureSetupTree([{ path: "src/owner.ts", body: "// owner bytes\r\n" }], {
    name: "Field Log", description: "Keep notes on calibration runs.", entityId: entity,
  }).map(({ path, body }) => [path, body]));
  if (options.coverRecords) {
    const parsed = repositoryConfigSchema.parse(JSON.parse(files.get(config)!));
    files.set(config, JSON.stringify({ ...parsed, coverage: { include: [".nutshell/changes/**"], exclude: [] } }));
  }
  if (options.archivedMemory) {
    files.set("nutshell-vault/archive/Old log.md", files.get(memory)!
      .replace("id: feature-nutshell-setup", "id: old-log")
      .replace("status: active", "status: archived"));
  }
  for (const [path, body] of files) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  onTestFinished(() => log.mockRestore());
  const output = () => JSON.parse(String(log.mock.lastCall?.[0]));
  return { cwd, files, output };
}

function addFlags({ id = change, type = "fixed", impact = "user_visible", rationale = "Keep calibration notes usable." } = {}) {
  return [
    "add", "--id", id, "--type", type, "--summary", "Preserve calibration observations.",
    "--impact", impact, "--rationale", rationale, "--technical-summary", "Retain existing entries during calibration.", "--json",
  ];
}

test("authors exactly one record without applying the repository's Git-only coverage gate", () => {
  const { cwd, files, output } = scratch({ coverRecords: true });
  const args = [...addFlags(), "--entity", entity, "--memory", memory, "--memory", "nutshell-vault/_INDEX.md"];
  expect(runChangeCommand(args, cwd)).toBe(0);
  const path = record(change);
  const written = readFileSync(join(cwd, path), "utf8");
  expect(written).toBe(JSON.stringify({
    schema_version: 1, id: change, entity_ids: [entity], change_type: "fixed", summary: "Preserve calibration observations.",
    product_impact: "user_visible", rationale: "Keep calibration notes usable.",
    technical_summary: "Retain existing entries during calibration.", memory_paths: [memory, "nutshell-vault/_INDEX.md"], evidence: [],
  }, null, 2) + "\n");
  expect(output()).toEqual({ scope: "change-authoring", source: { kind: "working-tree" }, ok: true, path, change: JSON.parse(written) });
  expect(readdirSync(join(cwd, ".nutshell/changes")).sort()).toEqual([`${change}.json`, `${original}.json`]);
  for (const [existing, body] of files) expect(readFileSync(join(cwd, existing), "utf8")).toBe(body);
  const head = new Map(files).set(path, written);
  expect(validateRepositoryChanges({ baseFiles: files, headFiles: head, changedPaths: [path] })).toMatchObject({
    ok: false, issues: [{ path, code: "covered-unmapped" }],
  });
  expect(runChangeCommand(args, cwd)).toBe(1);
  expect(output()).toMatchObject({ ok: false, issues: [{ path, code: "record-duplicate" }] });
  expect(readFileSync(join(cwd, path), "utf8")).toBe(written);
});

test("rejects placeholders, user-visible changes without entities, and unknown or archived references", () => {
  const { cwd, output } = scratch({ archivedMemory: true });
  const cases = [
    { args: addFlags({ rationale: "N / A" }), error: "change-placeholder" },
    { args: addFlags(), error: "change-impact" },
    { args: [...addFlags(), "--entity", "ent_unknown"], error: "change-entity" },
    { args: [...addFlags(), "--entity", entity, "--memory", "nutshell-vault/archive/Old log.md"], error: "memory-target" },
    { args: [...addFlags(), "--entity", entity, "--memory", "nutshell-vault/missing.md"], error: "memory-target" },
    { args: [...addFlags(), "--entity", entity, "--memory", "nutshell-vault/../README.md"], error: "record-schema" },
    { args: addFlags({ id: "../escape" }), error: "record-schema" },
    { args: addFlags({ id: entity, impact: "internal" }), error: "record-duplicate" },
  ];
  for (const { args, error } of cases) {
    expect(runChangeCommand(args, cwd)).toBe(1);
    expect(output()).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: error })]) });
  }
  expect(readdirSync(join(cwd, ".nutshell/changes"))).toEqual([`${original}.json`]);
});

test("requires a distinct existing target for a correction or reversal", () => {
  const { cwd, output } = scratch();
  const args = addFlags({ type: "corrected", impact: "internal" });
  for (const flags of [[], ["--corrects", change], ["--corrects", "chg_missing"]]) {
    expect(runChangeCommand([...args, ...flags], cwd)).toBe(1);
    expect(output()).toMatchObject({ ok: false, issues: [{ path: record(change), code: "change-correction" }] });
    expect(existsSync(join(cwd, record(change)))).toBe(false);
  }
  expect(runChangeCommand([...args, "--corrects", original], cwd)).toBe(0);
  expect(output()).toMatchObject({ ok: true, change: { corrects_change_id: original } });
  const reversal = addFlags({ id: "chg_reversal", type: "reverted", impact: "none" });
  expect(runChangeCommand([...reversal, "--reverses", original, "--corrects", change], cwd)).toBe(1);
  expect(output()).toMatchObject({ ok: false, issues: [{ code: "change-correction" }] });
  expect(runChangeCommand([...reversal, "--reverses", change], cwd)).toBe(0);
  expect(output()).toMatchObject({ ok: true, change: { reverses_change_id: change } });
});

test("shows help without touching a checkout and rejects unexpected or repeated flags", () => {
  const { cwd } = scratch();
  const log = vi.mocked(console.log);
  const missing = join(cwd, "absent");
  expect(runChangeCommand(["--help"], missing)).toBe(0);
  expect(runChangeCommand(["add", "--help"], missing)).toBe(0);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining("--technical-summary"));
  expect(() => runChangeCommand(["add", "--id", change], missing)).toThrow("Missing required options");
  expect(() => runChangeCommand([...addFlags(), "--id", original], missing)).toThrow("Repeated option --id");
  expect(() => runChangeCommand([...addFlags(), "--attach-file", "KEY.txt"], missing)).toThrow("Unknown change option");
  expect(existsSync(missing)).toBe(false);
});
