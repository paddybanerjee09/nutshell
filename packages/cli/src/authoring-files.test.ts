import {
  constants, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { applyAuthoringEdits, missingAuthoringDirectories, readAuthoringTree } from "./authoring-files.ts";

const { intercept } = vi.hoisted(() => ({ intercept: { open: undefined as ((path: string, flags: string | number) => void) | undefined } }));
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    openSync(...args: Parameters<typeof fs.openSync>) {
      if (typeof args[0] === "string") intercept.open?.(args[0], args[1]);
      return fs.openSync(...args);
    },
  };
});
afterEach(() => { intercept.open = undefined; });

function scratch() {
  const parent = realpathSync.native(tmpdir());
  const root = mkdtempSync(join(parent, "nutshell-authoring-test-"));
  onTestFinished(() => {
    const checked = realpathSync.native(root);
    if (dirname(checked) !== parent || checked !== root) throw new Error("Unexpected authoring fixture path.");
    rmSync(checked, { recursive: true, force: true });
  });
  return root;
}

function write(root: string, path: string, value: string | Buffer) {
  const absolute = join(root, ...path.split("/"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value);
}

describe("guarded repository authoring", () => {
  it("reads exact managed UTF-8 without requiring a vault or reading source bytes", () => {
    const root = scratch();
    const owner = "\uFEFF# Existing instructions\r\n\r\nKeep 雪 unchanged.\r\n";
    write(root, "AGENTS.md", owner);
    write(root, "README.md", "# Existing README\r\n");
    write(root, "src/binary.dat", Buffer.alloc(512 * 1024, 255));
    write(root, "unmanaged.md", Buffer.from([255]));
    expect(readAuthoringTree(root)).toEqual(new Map([
      ["AGENTS.md", owner], ["README.md", "# Existing README\r\n"], ["src/binary.dat", ""],
    ]));
    expect(missingAuthoringDirectories(root, ["nutshell-vault/decisions", "nutshell-vault/archive"]))
      .toEqual(["nutshell-vault/archive", "nutshell-vault/decisions"]);

    applyAuthoringEdits(root, [
      { path: ".nutshell/config.json", body: "{}\n" },
      { path: "nutshell-vault/features/owner/Memo.md", body: "\uFEFF# Note\r\nMeaningful note.\r\n" },
      { path: "AGENTS.md", previousBody: owner, body: owner + "\r\nManaged instructions.\r\n" },
    ], ["nutshell-vault/decisions", "nutshell-vault/archive"]);
    expect(readFileSync(join(root, "AGENTS.md"))).toEqual(Buffer.from(owner + "\r\nManaged instructions.\r\n"));
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Existing README\r\n");
    expect(readAuthoringTree(root).get(".nutshell/config.json")).toBe("{}\n");
    expect(readAuthoringTree(root).get("nutshell-vault/features/owner/Memo.md")).toBe("\uFEFF# Note\r\nMeaningful note.\r\n");
    expect(missingAuthoringDirectories(root, ["nutshell-vault/decisions", "nutshell-vault/archive"])).toEqual([]);
  });

  it("preflights path aliases, occupied files, stale owners and invalid bodies before writing", () => {
    const root = scratch();
    write(root, "AGENTS.md", "# Current owner instructions\r\n");
    write(root, ".nutshell/changes/existing.json", "existing bytes");
    const planned = { path: "nutshell-vault/new.md", body: "untouched" };
    const badEdits = [
      { path: "../AGENTS.md", body: "x" },
      { path: "nutshell-vault/.git/new.md", body: "x" },
      { path: "nutshell-vault/%2e%2e/new.md", body: "x" },
      { path: ".nutshell/changes/CON.json", body: "x" },
      { path: ".nutshell/changes/existing.json", body: "x" },
      { path: "AGENTS.md", previousBody: "# Stale", body: "# Stale\nappend" },
      { path: "AGENTS.md", previousBody: "# Current owner instructions\r\n", body: "rewrite" },
      { path: "notes.md", body: "unmanaged" },
      { path: "nutshell-vault/invalid.md", body: "bad\uD800" },
      { path: "nutshell-vault/NEW.md", body: "case-fold duplicate" },
    ];
    for (const bad of badEdits) {
      expect(() => applyAuthoringEdits(root, [planned, bad])).toThrow();
      expect(statSync(join(root, "nutshell-vault"), { throwIfNoEntry: false })).toBeUndefined();
    }
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("# Current owner instructions\r\n");
    expect(readFileSync(join(root, ".nutshell", "changes", "existing.json"), "utf8")).toBe("existing bytes");
  });

  it("preserves historical metadata without reading historical bodies and rejects unknown record inputs", () => {
    const root = scratch();
    const archiveHeader = "---\r\nid: old-note\r\nstatus: archived\r\n---\r\n";
    write(root, "nutshell-vault/archive/old.md", Buffer.concat([Buffer.from(archiveHeader), Buffer.alloc(512 * 1024, 255)]));
    expect(readAuthoringTree(root).get("nutshell-vault/archive/old.md")).toBe(archiveHeader);
    write(root, ".nutshell/unknown.json", Buffer.from([255]));
    expect(() => readAuthoringTree(root)).toThrow(/Unexpected repository record entry "\.nutshell\/unknown\.json"/u);
  });

  it("refuses managed junctions and linked owner instructions", () => {
    const root = scratch();
    write(root, "outside/config.json", "untouched");
    symlinkSync(join(root, "outside"), join(root, ".nutshell"), process.platform === "win32" ? "junction" : "dir");
    expect(() => readAuthoringTree(root)).toThrow(/symbolic link/u);
    expect(() => applyAuthoringEdits(root, [{ path: ".nutshell/config.json", body: "must not write" }])).toThrow(/symbolic link/u);
    expect(readFileSync(join(root, "outside", "config.json"), "utf8")).toBe("untouched");

    const second = scratch();
    write(second, "other.md", "# Unrelated owner file");
    linkSync(join(second, "other.md"), join(second, "AGENTS.md"));
    expect(() => readAuthoringTree(second)).toThrow(/regular, unlinked/u);
    expect(() => applyAuthoringEdits(second, [{ path: "AGENTS.md", previousBody: "# Unrelated owner file",
      body: "# Unrelated owner file\nNo append." }])).toThrow(/regular, unlinked/u);
    expect(readFileSync(join(second, "other.md"), "utf8")).toBe("# Unrelated owner file");
  });

  it.each([false, true])("leaves a late exclusive-create contender and rolls back only unchanged own writes (%s)", (touchOwned) => {
    const root = scratch();
    const first = join(root, "nutshell-vault", "first.md");
    const contested = join(root, "nutshell-vault", "contested.md");
    intercept.open = (path, flags) => {
      if (path !== contested || typeof flags !== "number" || !(flags & constants.O_EXCL)) return;
      writeFileSync(contested, "from another process", { flag: "wx" });
      if (touchOwned) writeFileSync(first, "edited by the owner");
    };
    expect(() => applyAuthoringEdits(root, [
      { path: "nutshell-vault/first.md", body: "made by this invocation" },
      { path: "nutshell-vault/contested.md", body: "must not overwrite" },
    ])).toThrow();
    expect(readFileSync(contested, "utf8")).toBe("from another process");
    if (touchOwned) expect(readFileSync(first, "utf8")).toBe("edited by the owner");
    else expect(statSync(first, { throwIfNoEntry: false })).toBeUndefined();
  });
});
