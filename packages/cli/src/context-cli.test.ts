import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { VaultContextResult } from "@nutshell/core/context-retrieval";
import { onTestFinished, test } from "vitest";

const main = fileURLToPath(new URL("./main.ts", import.meta.url));
const indexPath = "nutshell-vault/_INDEX.md";
const taskPath = "nutshell-vault/CURRENT_TASK.md";
const sensorsPath = "nutshell-vault/features/sensors/CONTEXT.md";
const archivePath = "nutshell-vault/archive/sensor-calibration-old.md";

function note(id: string, context: string, decision: string, status = "active", fields = "") {
  return [
    "---", "id: " + id, 'date: "2026-11-27"', "status: " + status, "tags: [fixture]",
    fields ? fields.trimEnd() + "\n---" : "---", "",
    "## Context", "", context, "",
    "## Decision", "", decision, "",
    "## Consequences", "", "This note belongs to the isolated CLI fixture.", "",
    "## Affected files", "", "\x60src/sensors/calibration.ts\x60", "",
  ].join("\n");
}

const indexBody = note("fixture-index", "Route context requests using the indexed catalog.", [
  "| Path | Description | Status | Tags |",
  "| --- | --- | --- | --- |",
  "| [" + indexPath + "](_INDEX.md) | Vault routing | active | control |",
  "| [" + taskPath + "](CURRENT_TASK.md) | Current feature | active | control |",
  "| [" + sensorsPath + "](features/sensors/CONTEXT.md) | Sensor calibration rules | active | sensors, calibration |",
  "| [nutshell-vault/features/billing/CONTEXT.md](features/billing/CONTEXT.md) | Invoice settlement | active | billing |",
].join("\n"));

const taskBody = note("fixture-task", "No feature task is active.", "Read task-specific context.", "active", [
  "task_id: null", "task_state: idle", "task_revision: 1", "repository_id: null", "branch: null", "base_branch: null",
  "pr_number: null", "pr_url: null", "last_verified_head: null", "lead_agent: null", "integration_checkout: null", "cleanup_pr_url: null",
].join("\n"));

function fixtureRoot() {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, "nutshell-context-cli-"));
  onTestFinished(() => {
    const resolved = realpathSync.native(root);
    if (dirname(resolved) !== parent || !basename(resolved).startsWith("nutshell-context-cli-")) {
      throw new Error("Unexpected context fixture directory.");
    }
    rmSync(resolved, { recursive: true, force: true });
  });
  return root;
}

function write(root: string, file: string, body: string) {
  const target = join(root, ...file.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.hooksPath=" + join(root, "empty-hooks"), ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 15_000,
  }).trim();
}

function commit(root: string, message: string) {
  git(root, "-c", "user.name=Nutshell context test fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--no-gpg-sign", "-am", message);
}

type CliResult = { status: number | undefined; stdout: string; stderr: string; failure: Error | null };

function cli(root: string, args: string[], budget = "4000") {
  return new Promise<CliResult>((resolve) => {
    execFile(process.execPath, [
      main, "context", "--query", "sensor calibration", "--paths", sensorsPath + ",src/sensors/calibration.ts",
      "--budget", budget, "--json", ...args,
    ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000 }, (error, stdout, stderr) => {
      const status = error ? error.code : 0;
      resolve(typeof status === "number"
        ? { status, stdout, stderr, failure: null }
        : { status: undefined, stdout, stderr, failure: error });
    });
  });
}

function readResult(result: CliResult, expectedCode = 0): VaultContextResult {
  assert.ifError(result.failure);
  assert.equal(result.status, expectedCode, result.stderr);
  assert.ok(result.stdout.trim(), result.stderr || "Expected JSON from the context CLI.");
  return JSON.parse(result.stdout) as VaultContextResult;
}

test("CLI context separates committed, working-tree and historical results and requires both controls", async () => {
  const root = fixtureRoot();
  const baseText = "Base sensor calibration procedure.";
  const headText = "Checked-out sensor calibration procedure for café measurements.";
  const workingText = "Uncommitted sensor calibration procedure.";
  const historicalText = "Retired sensor calibration value 77.";
  function writeSensors(decision: string) {
    write(root, sensorsPath, note("sensor-calibration",
      "Sensor calibration uses the current settings. See the [previous procedure](../../archive/sensor-calibration-old.md).",
      decision));
  }

  git(root, "init", "--quiet", "--initial-branch=main", "--template=");
  write(root, indexPath, indexBody);
  write(root, taskPath, taskBody);
  write(root, archivePath, note("old-sensor-calibration", "Historical sensor calibration.", historicalText, "superseded",
    "superseded_by: " + sensorsPath));
  write(root, "nutshell-vault/features/billing/CONTEXT.md", note("billing", "Invoice settlement.", "Record completed invoices."));
  writeSensors(baseText);
  git(root, "add", "--", "nutshell-vault");
  commit(root, "Base context fixture");
  git(root, "switch", "--quiet", "-c", "fixture-context");
  writeSensors(headText);
  commit(root, "Checked-out context fixture");
  const [base, head] = git(root, "rev-parse", "main", "HEAD").split(/\r?\n/u);
  assert.ok(base && head && base !== head);
  writeSensors(workingText);

  const [defaultRead, oldRead, workingRead] = await Promise.all([
    cli(root, []),
    cli(root, ["--ref", "main", "--include-archive"]),
    cli(root, ["--working-tree"]),
  ]);
  const current = readResult(defaultRead);
  assert.deepEqual(current.source, { kind: "git", revision: head });
  assert.deepEqual(current.controls, [{ path: indexPath, body: indexBody }, { path: taskPath, body: taskBody }]);
  assert.deepEqual(current.historical, []);
  assert.deepEqual(current.notes.map(({ path }) => path), [sensorsPath]);
  const [currentSensor] = current.notes;
  assert.ok(currentSensor);
  assert.equal(currentSensor.historical, false);
  assert.ok(currentSensor.headings.includes("Decision"));
  assert.ok(currentSensor.reasons.some((reason) => /path|sensor|calibration/iu.test(reason)));
  assert.ok(currentSensor.excerpt.includes(headText));
  assert.ok(!defaultRead.stdout.includes(workingText));
  assert.ok(!defaultRead.stdout.includes(historicalText));
  assert.equal(current.budget.unit, "estimated_tokens");
  assert.equal(current.budget.used, Math.ceil(Buffer.byteLength(indexBody + taskBody + currentSensor.excerpt) / 4));

  const old = readResult(oldRead);
  assert.deepEqual(old.source, { kind: "git", revision: base });
  assert.ok(old.notes[0]?.excerpt.includes(baseText));
  assert.ok(!oldRead.stdout.includes(headText));
  assert.deepEqual(old.historical.map(({ path }) => path), [archivePath]);
  const [retired] = old.historical;
  assert.ok(retired);
  assert.equal(retired.historical, true);
  assert.equal(retired.status, "superseded");
  assert.equal(retired.replacement, sensorsPath);
  assert.ok(retired.excerpt.includes(historicalText));

  const working = readResult(workingRead);
  assert.deepEqual(working.source, { kind: "working-tree", revision: "working-tree" });
  assert.ok(working.notes[0]?.excerpt.includes(workingText));
  assert.ok(!workingRead.stdout.includes(headText));
  assert.deepEqual(working.historical, []);

  const [insufficient, contradictory] = await Promise.all([
    cli(root, [], "1"),
    cli(root, ["--ref", "HEAD", "--working-tree"]),
  ]);
  const budgetError = readResult(insufficient, 2);
  assert.equal(budgetError.status, "invalid");
  assert.ok(budgetError.gaps.some(({ code }) => code === "control-budget"));
  assert.equal(budgetError.budget.requiredControlTokens, Math.ceil(Buffer.byteLength(indexBody + taskBody) / 4));
  assert.deepEqual(budgetError.controls, []);

  assert.ifError(contradictory.failure);
  assert.equal(contradictory.status, 2);
  assert.match(contradictory.stderr, /--ref.*--working-tree|--working-tree.*--ref/u);
}, process.platform === "win32" ? 120_000 : 40_000);
