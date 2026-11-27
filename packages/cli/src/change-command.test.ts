import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

test("authors exactly one record without applying the repository's Git-only coverage gate", async () => {
  const { cwd, files, output } = scratch({ coverRecords: true });
  const args = [...addFlags(), "--entity", entity, "--memory", memory, "--memory", "nutshell-vault/_INDEX.md"];
  expect(await runChangeCommand(args, cwd)).toBe(0);
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
  expect(await runChangeCommand(args, cwd)).toBe(1);
  expect(output()).toMatchObject({ ok: false, issues: [{ path, code: "record-duplicate" }] });
  expect(readFileSync(join(cwd, path), "utf8")).toBe(written);
});

test("rejects placeholders, user-visible changes without entities, and unknown or archived references", async () => {
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
    expect(await runChangeCommand(args, cwd)).toBe(1);
    expect(output()).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: error })]) });
  }
  expect(readdirSync(join(cwd, ".nutshell/changes"))).toEqual([`${original}.json`]);
});

test("requires a distinct existing target for a correction or reversal", async () => {
  const { cwd, output } = scratch();
  const args = addFlags({ type: "corrected", impact: "internal" });
  for (const flags of [[], ["--corrects", change], ["--corrects", "chg_missing"]]) {
    expect(await runChangeCommand([...args, ...flags], cwd)).toBe(1);
    expect(output()).toMatchObject({ ok: false, issues: [{ path: record(change), code: "change-correction" }] });
    expect(existsSync(join(cwd, record(change)))).toBe(false);
  }
  expect(await runChangeCommand([...args, "--corrects", original], cwd)).toBe(0);
  expect(output()).toMatchObject({ ok: true, change: { corrects_change_id: original } });
  const reversal = addFlags({ id: "chg_reversal", type: "reverted", impact: "none" });
  expect(await runChangeCommand([...reversal, "--reverses", original, "--corrects", change], cwd)).toBe(1);
  expect(output()).toMatchObject({ ok: false, issues: [{ code: "change-correction" }] });
  expect(await runChangeCommand([...reversal, "--reverses", change], cwd)).toBe(0);
  expect(output()).toMatchObject({ ok: true, change: { reverses_change_id: change } });
});

test("keeps a committed event usable after its narrative note is archived", async () => {
  const { cwd, files, output } = scratch();
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Nutshell fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", timeout: 10_000 }).trim();
  const commit = (message: string) => {
    git("add", "-A");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-b", "main");
  const narrative = "nutshell-vault/features/Calibration.md";
  const archive = "nutshell-vault/archive/Calibration.md";
  const index = "nutshell-vault/_INDEX.md";
  const note = files.get(memory)!.replace("id: feature-nutshell-setup", "id: feature-calibration");
  const catalog = files.get(index)!;
  const row = "| [" + narrative + "](features/Calibration.md) | Calibration notes. | active | fixture |\n";
  const marker = "\n## Consequences";
  expect(catalog).toContain(marker);
  writeFileSync(join(cwd, index), catalog.replace("\n" + marker, "\n" + row + marker));
  writeFileSync(join(cwd, narrative), note);
  const historical = "chg_calibration_start";
  const args = [...addFlags({ id: historical }), "--entity", entity, "--memory", narrative];
  expect(await runChangeCommand(args, cwd)).toBe(0);
  const historicalRecord = readFileSync(join(cwd, record(historical)), "utf8");
  commit("Publish calibration history");
  mkdirSync(dirname(join(cwd, archive)), { recursive: true });
  renameSync(join(cwd, narrative), join(cwd, archive));
  writeFileSync(join(cwd, archive), note.replace("status: active", "status: archived"));
  writeFileSync(join(cwd, index), catalog);
  const archivedBase = commit("Archive the original narrative");

  const correction = [...addFlags({ type: "corrected", impact: "internal" }), "--corrects", historical, "--memory", memory];
  expect(await runChangeCommand(correction, cwd)).toBe(0);
  expect(output()).toMatchObject({ ok: true, change: { corrects_change_id: historical } });
  expect(readFileSync(join(cwd, record(historical)), "utf8")).toBe(historicalRecord);
  const current = commit("Add a correction after archival");
  const validation = execFileSync(process.execPath, [resolve("packages/cli/src/main.ts"), "validate", "--base", archivedBase, "--head", current, "--json"],
    { cwd, encoding: "utf8", timeout: 15_000 });
  expect(JSON.parse(validation)).toMatchObject({ ok: true, source: { base: archivedBase, head: current } });

  const attempted = [...addFlags({ id: "chg_unpublished" }), "--entity", entity];
  writeFileSync(join(cwd, record(historical)), historicalRecord.replace("Keep calibration notes usable.", "Rewrite the committed narrative."));
  expect(await runChangeCommand(attempted, cwd)).toBe(1);
  expect(output()).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ code: "change-rewritten" })]) });
  expect(existsSync(join(cwd, record("chg_unpublished")))).toBe(false);
}, 45_000);

test("shows help without touching a checkout and rejects unexpected or repeated flags", async () => {
  const { cwd } = scratch();
  const log = vi.mocked(console.log);
  const missing = join(cwd, "absent");
  expect(await runChangeCommand(["--help"], missing)).toBe(0);
  expect(await runChangeCommand(["add", "--help"], missing)).toBe(0);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining("--technical-summary"));
  await expect(runChangeCommand(["add", "--id", change], missing)).rejects.toThrow("Missing required options");
  await expect(runChangeCommand([...addFlags(), "--id", original], missing)).rejects.toThrow("Repeated option --id");
  await expect(runChangeCommand([...addFlags(), "--attach-file", "KEY.txt"], missing)).rejects.toThrow("Unknown change option");
  expect(existsSync(missing)).toBe(false);
});
