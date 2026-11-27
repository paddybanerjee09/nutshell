import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { bootstrapRepositoryCoverage } from "@nutshell/core/change-validation";
import { projectRepositoryTree } from "@nutshell/core/snapshot";
import { expect, onTestFinished, test, vi } from "vitest";
import { readAuthoringTree } from "./authoring-files.ts";
import { runInitCommand } from "./init-command.ts";

function scratchDirectory() {
  const parent = realpathSync.native(tmpdir());
  const cwd = mkdtempSync(join(parent, "nutshell-init-test-"));
  onTestFinished(() => {
    const target = realpathSync.native(cwd);
    if (dirname(target) !== parent || !basename(target).startsWith("nutshell-init-test-")) {
      throw new Error("Unexpected Nutshell init fixture directory.");
    }
    rmSync(target, { recursive: true, force: true });
  });
  return cwd;
}

function readInitReports(cwd: string) {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  onTestFinished(() => { log.mockRestore(); });
  return (...args: string[]) => {
    expect(runInitCommand([...args, "--json"], cwd)).toBe(0);
    return JSON.parse(log.mock.lastCall![0]);
  };
}

test("init previews and creates a valid local setup while preserving existing owner bytes", () => {
  const cwd = scratchDirectory();
  const report = readInitReports(cwd);
  const owner = Buffer.from("\uFEFF# Owner instructions\r\n\r\nUse the visible sample.  \r\n");
  const readme = Buffer.from("# My repository\r\n\r\nOwner prose.  \r\n");
  const spec = Buffer.from("# Existing requirements\nWith a trailing space.  ");
  const source = Buffer.from([0, 255, 17]);
  writeFileSync(join(cwd, "AGENTS.md"), owner);
  writeFileSync(join(cwd, "README.md"), readme);
  writeFileSync(join(cwd, "SPEC.md"), spec);
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "owner.bin"), source);

  const preview = report();
  expect(preview).toMatchObject({
    scope: "repository-init", mode: "preview", status: "planned",
    directories: ["nutshell-vault/archive", "nutshell-vault/decisions"],
  });
  expect(preview.files).toEqual([
    { path: ".nutshell/changes/chg_nutshell_setup.json", action: "create" },
    { path: ".nutshell/config.json", action: "create" },
    { path: ".nutshell/entities/ent_nutshell_repository.json", action: "create" },
    { path: "AGENTS.md", action: "append" },
    { path: "nutshell-vault/CURRENT_TASK.md", action: "create" },
    { path: "nutshell-vault/_INDEX.md", action: "create" },
    { path: "nutshell-vault/features/nutshell-setup/CONTEXT.md", action: "create" },
    { path: "nutshell-vault/templates/NOTE.md", action: "create" },
    { path: "nutshell-vault/templates/TASK.md", action: "create" },
  ]);
  expect(report()).toEqual(preview);
  expect(existsSync(join(cwd, "nutshell-vault"))).toBe(false);
  expect(existsSync(join(cwd, ".nutshell"))).toBe(false);
  expect(readFileSync(join(cwd, "AGENTS.md"))).toEqual(owner);

  expect(report("--write")).toEqual({ ...preview, mode: "write", status: "written" });
  for (const directory of preview.directories) expect(statSync(join(cwd, directory)).isDirectory()).toBe(true);
  const installedOwner = readFileSync(join(cwd, "AGENTS.md"));
  expect(installedOwner.subarray(0, owner.length)).toEqual(owner);
  expect(installedOwner.toString("utf8")).toContain("\r\n\r\n<!-- nutshell:managed:start -->\r\n");
  expect(readFileSync(join(cwd, "README.md"))).toEqual(readme);
  expect(readFileSync(join(cwd, "SPEC.md"))).toEqual(spec);
  expect(readFileSync(join(cwd, "src", "owner.bin"))).toEqual(source);

  const tree = readAuthoringTree(cwd);
  const projection = projectRepositoryTree(tree);
  expect(projection).toMatchObject({ ok: true, snapshot: {
    config: { coverage: bootstrapRepositoryCoverage },
    entities: [{ id: "ent_nutshell_repository", code_paths: ["src/**"] }],
    changes: [{ id: "chg_nutshell_setup", entity_ids: ["ent_nutshell_repository"] }],
  } });
  expect(tree.get("nutshell-vault/CURRENT_TASK.md")).toContain("task_state: idle\ntask_revision: 0");
  expect(tree.get("nutshell-vault/features/nutshell-setup/CONTEXT.md")).not.toMatch(/fixture|simulat|provider/iu);
  expect(tree.get(".nutshell/changes/chg_nutshell_setup.json")).not.toMatch(/fixture|simulat|provider|proposal/iu);

  const entity = join(cwd, ".nutshell/entities/ent_nutshell_repository.json");
  const customized = readFileSync(entity, "utf8").replace('"title": "Repository"', '"title": "Owner map"');
  writeFileSync(entity, customized);
  expect(report("--write")).toEqual({ ...preview, mode: "write", status: "configured", files: [], directories: [] });
  expect(readFileSync(entity, "utf8")).toBe(customized);
  expect(readFileSync(join(cwd, "AGENTS.md"))).toEqual(installedOwner);
});

test("init refuses conflicts before touching owner content or creating its other targets", () => {
  const cwd = scratchDirectory();
  const index = join(cwd, "nutshell-vault", "_INDEX.md");
  mkdirSync(dirname(index));
  const ownerIndex = "# Owner catalog\r\n\r\nWork in progress.\r\n";
  writeFileSync(index, ownerIndex);
  expect(() => runInitCommand(["--write"], cwd)).toThrow("Setup cannot use nutshell-vault/_INDEX.md");
  expect(() => runInitCommand(["--write", "--write"], cwd)).toThrow("Repeated option");
  expect(() => runInitCommand(["--force"], cwd)).toThrow("Unknown init option");
  expect(readFileSync(index, "utf8")).toBe(ownerIndex);
  expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
  expect(existsSync(join(cwd, ".nutshell"))).toBe(false);
  expect(existsSync(join(cwd, "nutshell-vault", "archive"))).toBe(false);
});
