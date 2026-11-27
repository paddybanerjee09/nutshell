import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import { repositoryConfigSchema, repositoryEntitySchema, type RepositoryChange } from "@nutshell/core/snapshot";
import { onTestFinished, test } from "vitest";

const main = fileURLToPath(new URL("./main.ts", import.meta.url));
const configPath = ".nutshell/config.json";
const entityId = "ent_calibration";
const contextPath = "nutshell-vault/features/nutshell-setup/CONTEXT.md";
const originalPath = "src/calibration/café old.ts";
const renamedPath = "src/calibration/café new.ts";
const changeId = "chg_calibration_path";
const impossibleDriver = "nutshell-fixture-unavailable-diff-driver";
const gitEnv = {
  ...process.env,
  GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_COMMON_DIR: undefined, GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined, GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined, GIT_CONFIG_COUNT: undefined,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
  GIT_AUTHOR_NAME: "Nutshell comparison fixture", GIT_AUTHOR_EMAIL: "comparison@example.invalid",
  GIT_COMMITTER_NAME: "Nutshell comparison fixture", GIT_COMMITTER_EMAIL: "comparison@example.invalid",
};

function temporaryRepository() {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, "nutshell-git-comparison-"));
  onTestFinished(() => {
    const resolved = realpathSync.native(root);
    if (dirname(resolved) !== parent || !basename(resolved).startsWith("nutshell-git-comparison-")) {
      throw new Error("Unexpected Git comparison fixture directory.");
    }
    rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.hooksPath=" + join(root, "empty-hooks"), ...args], {
    cwd: root, env: gitEnv, encoding: "utf8", timeout: 20_000, windowsHide: true,
  }).trim();
}

function write(root: string, path: string, contents: string | Buffer) {
  const target = join(root, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function commit(root: string, message: string) {
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "--no-gpg-sign", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function cli(cwd: string, args: string[]) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [main, ...args], {
      cwd, env: { ...gitEnv, GIT_EXTERNAL_DIFF: impossibleDriver }, encoding: "utf8", windowsHide: true, timeout: 45_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") reject(error);
      else resolve({ status: typeof error?.code === "number" ? error.code : 0, stdout, stderr });
    });
  });
}

type Comparison = {
  scope: string;
  source: { kind: "git"; base: string; head: string };
  ok: boolean;
  policyVersion: number;
  mappings: { path: string; covered: boolean; entityIds: string[]; changeIds: string[]; memoryPaths: string[] }[];
  issues: { code: string; path: string; severity: "error" | "warning" }[];
};

test("CLI compares immutable trees, maps both rename endpoints and keeps base coverage", async () => {
  const root = temporaryRepository();
  git(root, "init", "--quiet", "--initial-branch=main", "--template=");
  git(root, "config", "diff.external", impossibleDriver);
  git(root, "config", "diff.fixture.textconv", impossibleDriver);
  const fixture = new Map(buildFixtureSetupTree([{ path: originalPath, body: "Fixture source." }], {
    name: "Calibration", description: "Check field calibration before data collection.", entityId,
  }).map(({ path, body }) => [path, body]));
  for (const [path, body] of fixture) if (!path.startsWith(".nutshell/")) write(root, path, body);
  write(root, ".gitattributes", "*.ts diff=fixture\n");
  // Code blobs are inventory only. This deliberately exceeds the managed-file limit and is invalid UTF-8.
  write(root, originalPath, Buffer.alloc(300 * 1024, 255));
  const unconfigured = commit(root, "Unconfigured comparison fixture");

  const entityPath = `.nutshell/entities/${entityId}.json`;
  const entity = repositoryEntitySchema.parse(JSON.parse(fixture.get(entityPath)!));
  fixture.set(entityPath, JSON.stringify({ ...entity, code_paths: ["src/calibration/**"] }));
  for (const [path, body] of fixture) if (path.startsWith(".nutshell/")) write(root, path, body);
  const base = commit(root, "Configure comparison fixture");

  renameSync(join(root, originalPath), join(root, renamedPath));
  const change: RepositoryChange = {
    schema_version: 1, id: changeId, entity_ids: [entityId], change_type: "changed", product_impact: "internal",
    summary: "Rename the field calibration source module.", rationale: "Match the new calibration terminology.",
    technical_summary: "Move the existing module to its new encoded Git path without modifying its bytes.",
    memory_paths: [contextPath], evidence: [],
  };
  write(root, `.nutshell/changes/${changeId}.json`, JSON.stringify(change));
  const head = commit(root, "Move calibration source with a change record");

  const config = repositoryConfigSchema.parse(JSON.parse(fixture.get(configPath)!));
  write(root, configPath, JSON.stringify({ ...config, coverage: { include: [], exclude: ["src/**"] } }));
  write(root, "src/unmapped.ts", "Candidate source has no entity or change declaration.\n");
  const declined = commit(root, "Candidate attempts to weaken its coverage");
  write(root, configPath, "Unsaved invalid config bytes are outside the immutable comparison.\n");

  const args = ["--base", base, "--head", head];
  const [impact, text, rejected, vaultOnly] = await Promise.all([
    cli(join(root, "src"), ["impact", ...args, "--json"]), cli(root, ["impact", ...args]),
    cli(root, ["validate", "--base", head, "--head", declined, "--json"]),
    cli(root, ["validate", "--base", unconfigured, "--head", unconfigured, "--json"]),
  ]);

  assert.equal(impact.status, 0, impact.stderr || impact.stdout);
  const report = JSON.parse(impact.stdout) as Comparison;
  assert.deepEqual(report.source, { kind: "git", base, head });
  assert.deepEqual([report.scope, report.policyVersion, report.ok], ["repository-impact", 1, true]);
  for (const path of [originalPath, renamedPath]) {
    const mapping = report.mappings.find((candidate) => candidate.path === path);
    assert.ok(mapping?.covered);
    assert.ok(mapping.entityIds.includes(entityId));
    assert.ok(mapping.changeIds.includes(changeId));
    assert.ok(mapping.memoryPaths.includes(contextPath));
  }

  assert.equal(text.status, 0, text.stderr);
  for (const phrase of ["Repository impact", renamedPath, entityId, changeId, contextPath]) assert.ok(text.stdout.includes(phrase));
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  const validation = JSON.parse(rejected.stdout) as Comparison;
  assert.deepEqual(validation.source, { kind: "git", base: head, head: declined });
  assert.equal(validation.scope, "repository-change-validation");
  assert.equal(validation.ok, false);
  assert.equal(validation.mappings.find(({ path }) => path === "src/unmapped.ts")?.covered, true);
  assert.ok(validation.issues.some(({ path, severity }) => path === "src/unmapped.ts" && severity === "error"));

  assert.equal(vaultOnly.status, 0, vaultOnly.stderr || vaultOnly.stdout);
  assert.deepEqual(JSON.parse(vaultOnly.stdout), { scope: "vault-snapshot", source: { kind: "git", base: unconfigured, head: unconfigured }, issues: [] });
}, 120_000);

test("impact requires two immutable refs", async () => {
  const root = temporaryRepository();
  const result = await cli(root, ["impact", "--working-tree"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Impact requires both --base and --head/u);
}, 45_000);
