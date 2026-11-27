import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { createContextSource } from "./context-source.ts";

function fixture() {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, "nutshell-context-test-"));
  onTestFinished(() => {
    if (dirname(root) !== parent) throw new Error("Unexpected context fixture directory.");
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function add(root: string, path: string, body: string | Buffer) {
  const file = join(root, ...path.split("/"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

test("working-tree context lists bounded metadata and opens only requested documents", async () => {
  const root = fixture();
  const index = "nutshell-vault/_INDEX.md";
  const large = "nutshell-vault/features/large.md";
  const archive = "nutshell-vault/archive/old.md";
  add(root, index, "working index");
  add(root, large, Buffer.alloc(256 * 1024 + 1));
  add(root, archive, "historical body");
  add(root, "other.md", "outside the managed vault");

  const source = await createContextSource(root, { kind: "working-tree" });
  try {
    expect(source.revision).toBe("working-tree");
    await expect(source.read(index)).resolves.toBe("working index");
    await expect(source.listPaths(false)).resolves.toEqual([index, large]);
    await expect(source.listPaths(true)).resolves.toEqual([index, archive, large]);
    await expect(source.read(large)).rejects.toThrow("Vault file exceeds");
    await expect(source.read(archive)).resolves.toBe("historical body");
    await expect(source.read("nutshell-vault/missing.md")).resolves.toBeUndefined();
    await expect(source.read("other.md")).rejects.toThrow("outside the managed vault");
    await expect(source.read("nutshell-vault/../other.md")).rejects.toThrow("Unsafe vault path");
    await expect(source.read("nutshell-vault/.git/config.md")).rejects.toThrow("Unsafe vault path");
  } finally {
    await source.close();
  }
  await expect(source.read(index)).rejects.toThrow("source is closed");
});

test("working-tree context prunes archive by default and refuses historical junctions and nested repos", async () => {
  const root = fixture();
  add(root, "nutshell-vault/_INDEX.md", "working index");
  add(root, "outside/old.md", "unrelated source");
  symlinkSync(join(root, "outside"), join(root, "nutshell-vault", "archive"), process.platform === "win32" ? "junction" : "dir");
  const source = await createContextSource(root, { kind: "working-tree" });
  try {
    await expect(source.listPaths(false)).resolves.toEqual(["nutshell-vault/_INDEX.md"]);
    await expect(source.listPaths(true)).rejects.toThrow("Symbolic link");
    await expect(source.read("nutshell-vault/archive/old.md")).rejects.toThrow("Symbolic link");
    add(root, "nutshell-vault/submodule/.git", "gitdir: ../../outside");
    add(root, "nutshell-vault/submodule/note.md", "nested source");
    await expect(source.read("nutshell-vault/submodule/note.md")).rejects.toThrow("Nested repository or submodule");
  } finally {
    await source.close();
  }
});

test("invalid UTF-8 still counts against the working-tree input budget", async () => {
  const root = fixture();
  const source = await createContextSource(root, { kind: "working-tree" });
  const invalid = Buffer.alloc(256 * 1024, 255);
  try {
    for (let index = 0; index < 16; index += 1) {
      const path = `nutshell-vault/invalid-${index}.md`;
      add(root, path, invalid);
      await expect(source.read(path)).rejects.toThrow("Invalid UTF-8");
    }
    add(root, "nutshell-vault/remaining.md", "x");
    await expect(source.read("nutshell-vault/remaining.md")).rejects.toThrow("Vault input exceeds 4194304 bytes");
  } finally {
    await source.close();
  }
});
