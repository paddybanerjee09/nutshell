import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, test } from "vitest";
import { readGitSnapshot, readWorkingTree } from "./vault-files.ts";

const main = fileURLToPath(new URL("./main.ts", import.meta.url));

function temporaryRoot(): string {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, "nutshell-vault-test-"));
  onTestFinished(() => {
    if (dirname(root) !== parent) throw new Error("Unexpected vault fixture directory.");
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function write(root: string, file: string, text: string | Buffer): void {
  const path = join(root, ...file.split("/"));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function commitFixture(root: string, message: string): string {
  git(root, "-c", "user.name=Nutshell CLI fixture", "-c", "user.email=fixture@example.invalid",
    "commit", "--quiet", "--no-gpg-sign", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

test("reads managed working-tree inputs and supplies only archive frontmatter", () => {
  const root = temporaryRoot();
  const archiveMetadata = "---\r\nid: older-note\r\nstatus: archived\r\n---\r\n";
  const exactArchiveMetadata = `---\na: ${"x".repeat(16 * 1024 - 11)}\n---`;
  write(root, "README.md", "readme");
  write(root, "unmanaged.md", "outside managed scope");
  write(root, "nutshell-vault/features/example/Note.MD", "active note");
  write(root, "nutshell-vault/features/example/style.css", "unmanaged extension");
  write(root, "nutshell-vault/archive/older.md", Buffer.concat([Buffer.from(archiveMetadata), Buffer.from([255])]));
  write(root, "nutshell-vault/archive/exact.md", exactArchiveMetadata);

  assert.deepEqual(readWorkingTree(root).files, new Map([
    ["README.md", "readme"],
    ["nutshell-vault/features/example/Note.MD", "active note"],
    ["nutshell-vault/archive/older.md", archiveMetadata],
    ["nutshell-vault/archive/exact.md", exactArchiveMetadata],
  ]));
});

test("refuses working-tree junctions or symbolic links", () => {
  const root = temporaryRoot();
  write(root, "outside/Note.md", "outside managed scope");
  mkdirSync(join(root, "nutshell-vault"));
  symlinkSync(join(root, "outside"), join(root, "nutshell-vault", "escape"), process.platform === "win32" ? "junction" : "dir");

  assert.throws(() => readWorkingTree(root), /Symbolic link in vault input/);
});

test("rejects oversized, deeply nested, or invalid UTF-8 working-tree inputs", () => {
  const root = temporaryRoot();
  write(root, "nutshell-vault/_INDEX.md", Buffer.alloc(256 * 1024 + 1));
  assert.throws(() => readWorkingTree(root), /Vault file exceeds/);

  write(root, "nutshell-vault/_INDEX.md", Buffer.from([255]));
  assert.throws(() => readWorkingTree(root), /Invalid UTF-8/);

  write(root, "nutshell-vault/_INDEX.md", "valid UTF-8");
  write(root, `nutshell-vault/${"nested/".repeat(16)}Note.md`, "deep note");
  assert.throws(() => readWorkingTree(root), /depth or byte limit/);
});

test("reads the resolved Git head even when the working tree differs", async () => {
  const root = temporaryRoot();
  const archiveMetadata = "---\nid: older-note\nstatus: archived\n---\n";
  git(root, "init", "--quiet", "--template=");
  git(root, "config", "--local", "core.autocrlf", "false");
  write(root, "nutshell-vault/_INDEX.md", "base copy\n");
  git(root, "add", "--", "nutshell-vault");
  const base = commitFixture(root, "base fixture");

  write(root, "nutshell-vault/_INDEX.md", "immutable head copy\n");
  write(root, "nutshell-vault/archive/older.md", Buffer.concat([Buffer.from(archiveMetadata), Buffer.alloc(32 * 1024, 255)]));
  git(root, "add", "--", "nutshell-vault");
  const head = commitFixture(root, "head fixture");
  write(root, "nutshell-vault/_INDEX.md", "uncommitted copy\n");

  const snapshot = await readGitSnapshot(root, "HEAD^", "HEAD");
  assert.equal(snapshot.base, base);
  assert.equal(snapshot.head, head);
  assert.equal(snapshot.files.get("nutshell-vault/_INDEX.md"), "immutable head copy\n");
  assert.equal(snapshot.files.get("nutshell-vault/archive/older.md"), archiveMetadata);
  assert.equal(readWorkingTree(root).files.get("nutshell-vault/_INDEX.md"), "uncommitted copy\n");
  await assert.rejects(readGitSnapshot(root, "--help", "HEAD"), /Invalid Git revision argument/);
  await assert.rejects(readGitSnapshot(root, "absent-ref", "HEAD"), /Unable to resolve Git revision/);

  const blob = git(root, "rev-parse", "HEAD:nutshell-vault/_INDEX.md");
  git(root, "update-index", "--add", "--cacheinfo", `120000,${blob},nutshell-vault/link.md`);
  commitFixture(root, "symlink fixture");
  await assert.rejects(readGitSnapshot(root, head, "HEAD"), /Symbolic link or submodule in vault input/);
}, 30_000);

test("CLI exposes help and rejects contradictory, duplicate, or incomplete options", () => {
  const root = temporaryRoot();
  const cli = (...args: string[]) => spawnSync(process.execPath, [main, ...args], {
    cwd: root, encoding: "utf8", windowsHide: true,
  });

  const help = cli("--help");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Scope: vault snapshot checks only/);
  for (const args of [
    ["validate", "--working-tree", "--base", "HEAD", "--head", "HEAD"],
    ["validate", "--base", "HEAD"],
    ["validate", "--base", "--head", "HEAD"],
    ["validate", "--working-tree", "--json", "--json"],
    ["validate", "--working-tree", "--surprise"],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^nutshell: /);
  }
  const invalid = cli("validate", "--working-tree", "--json");
  assert.equal(invalid.status, 1, invalid.stderr);
  const result = JSON.parse(invalid.stdout);
  assert.equal(result.scope, "vault-snapshot");
  assert.deepEqual(result.source, { kind: "working-tree" });
  assert.ok(result.issues.length > 0);
}, 30_000);
