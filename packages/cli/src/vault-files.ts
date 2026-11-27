import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

const rootNotes = ["AGENTS.md", "README.md", "SPEC.md"];
const vaultDirectory = "nutshell-vault";
export const archivePrefix = `${vaultDirectory}/archive/`;
const maxEntries = 4096;
const maxDocuments = 512;
export const maxFileBytes = 256 * 1024;
const maxArchiveHeaderBytes = 16 * 1024;
export const maxSnapshotBytes = 4 * 1024 * 1024;
export const gitTimeout = 15_000;
export const gitEnvironment = { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1" };
const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type SnapshotFiles = {
  bytes: number;
  files: Map<string, string>;
};

export function unpackUtf8(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid UTF-8 in ${JSON.stringify(path)}.`);
  }
}

function checkVaultPath(path: string): void {
  const parts = path.split("/");
  if (parts.length > 16 || Buffer.byteLength(path) > 512) {
    throw new Error("Vault path exceeds the depth or byte limit.");
  }
  if (parts.some((part) => {
    return !part || part.endsWith(".") || part.endsWith(" ")
      || /[\\:<>"|?*]/.test(part)
      || [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || /^(?:\.git|git~1)$/iu.test(part)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part);
  })) {
    throw new Error(`Unsafe vault path ${JSON.stringify(path)}.`);
  }
}

export function checkVaultDocumentPath(path: string): void {
  checkVaultPath(path);
  if (!rootNotes.includes(path) && !(path.startsWith(vaultDirectory + "/") && /\.md$/iu.test(path))) {
    throw new Error(`Path is outside the managed vault: ${JSON.stringify(path)}.`);
  }
}

function checkEntry(count: number, path: string): void {
  if (count > maxEntries) throw new Error(`Vault input exceeds ${maxEntries} entries.`);
  checkVaultPath(path);
}

function record(snapshot: SnapshotFiles, path: string, contents: string): void {
  if (snapshot.files.has(path)) throw new Error(`Duplicate vault path ${JSON.stringify(path)}.`);
  snapshot.bytes += Buffer.byteLength(contents);
  if (snapshot.bytes > maxSnapshotBytes) throw new Error(`Vault input exceeds ${maxSnapshotBytes} bytes.`);
  snapshot.files.set(path, contents);
}

function checkDocumentLimit(count: number): void {
  if (count > maxDocuments) throw new Error(`Vault input exceeds ${maxDocuments} documents.`);
}

// Interpret only ASCII delimiters, then decode the header without decoding an archive body.
function archiveHeader(prefix: Buffer, path: string, atEnd: boolean): string | undefined {
  const text = prefix.toString("latin1");
  const firstNewline = text.indexOf("\n");
  if (firstNewline < 0) return atEnd ? "" : undefined;
  if (!/^(?:\xef\xbb\xbf)?---[ \t]*\r?$/.test(text.slice(0, firstNewline))) return "";

  const rest = text.slice(firstNewline + 1);
  const closing = /(?:^|\n)---[ \t]*\r?\n/.exec(rest)
    ?? (atEnd ? /(?:^|\n)---[ \t]*$/.exec(rest) : null);
  if (!closing) return atEnd ? "" : undefined;
  const length = firstNewline + 1 + closing.index + closing[0].length;
  return unpackUtf8(prefix.subarray(0, length), path);
}

function localArchiveHeader(file: number, path: string): string {
  const prefix = Buffer.alloc(maxArchiveHeaderBytes + 1);
  let length = 0;
  while (length < prefix.length) {
    const count = readSync(file, prefix, length, Math.min(1024, prefix.length - length), null);
    length += count;
    const header = archiveHeader(prefix.subarray(0, Math.min(length, maxArchiveHeaderBytes)), path, count === 0);
    if (header !== undefined) return header;
  }
  throw new Error(`Archive frontmatter exceeds ${maxArchiveHeaderBytes} bytes in ${JSON.stringify(path)}.`);
}

function readLocalDocument(fullPath: string, path: string, archiveHeaderOnly: boolean, consumeBytes?: (bytes: number) => void): string {
  const before = lstatSync(fullPath);
  if (!before.isFile() || realpathSync.native(fullPath) !== fullPath) {
    throw new Error(`Expected a regular file at ${JSON.stringify(path)}.`);
  }
  const file = openSync(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(file);
    if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino) {
      throw new Error(`Vault file changed while opening ${JSON.stringify(path)}.`);
    }
    if (archiveHeaderOnly) return localArchiveHeader(file, path);
    if (opened.size > maxFileBytes) throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
    consumeBytes?.(opened.size);

    const bytes = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(file, bytes, length, bytes.length - length, null);
      if (count === 0) return unpackUtf8(bytes.subarray(0, length), path);
      length += count;
    }
    throw new Error(`Vault file grew while reading ${JSON.stringify(path)}.`);
  } finally {
    closeSync(file);
  }
}

function inspectWorkingEntry(fullPath: string, path: string) {
  const entry = lstatSync(fullPath, { throwIfNoEntry: false });
  if (!entry) return;
  if (entry.isSymbolicLink()) throw new Error(`Symbolic link in vault input: ${JSON.stringify(path)}.`);
  if (realpathSync.native(fullPath) !== fullPath) throw new Error(`Unsafe vault path ${JSON.stringify(path)}.`);
  if (entry.isDirectory() && lstatSync(join(fullPath, ".git"), { throwIfNoEntry: false })) {
    throw new Error(`Nested repository or submodule in vault input: ${JSON.stringify(path)}.`);
  }
  return entry;
}

function walkWorkingVault(root: string, includeArchive: boolean, visit: (path: string, fullPath: string) => void): void {
  let entries = 0;
  let documents = 0;

  function readEntry(path: string): void {
    if (!includeArchive && path === archivePrefix.slice(0, -1)) return;
    checkEntry(++entries, path);
    const fullPath = join(root, ...path.split("/"));
    const entry = inspectWorkingEntry(fullPath, path);
    if (!entry) return;

    if (entry.isDirectory() && (path === vaultDirectory || path.startsWith(`${vaultDirectory}/`))) {
      const directory = opendirSync(fullPath);
      try {
        for (let item = directory.readSync(); item; item = directory.readSync()) {
          if (item.name.includes("\\")) throw new Error(`Unsafe vault path ${JSON.stringify(item.name)}.`);
          readEntry(`${path}/${item.name}`);
        }
      } finally {
        directory.closeSync();
      }
    } else if (path === vaultDirectory || path.toLowerCase().endsWith(".md")) {
      if (path === vaultDirectory) throw new Error(`Expected a directory at ${JSON.stringify(path)}.`);
      if (!entry.isFile()) throw new Error(`Expected a regular file at ${JSON.stringify(path)}.`);
      checkDocumentLimit(++documents);
      visit(path, fullPath);
    }
  }

  for (const path of [...rootNotes, vaultDirectory]) readEntry(path);
}

export function listWorkingVault(root: string, includeArchive: boolean): string[] {
  const paths: string[] = [];
  walkWorkingVault(root, includeArchive, (path) => { paths.push(path); });
  return paths.sort();
}

export function readWorkingVaultDocument(
  root: string, path: string, consumeBytes: (bytes: number) => void, archiveHeaderOnly = false,
): string | undefined {
  checkVaultDocumentPath(path);
  const parts = path.split("/");
  let fullPath = root;
  for (const [index, part] of parts.entries()) {
    fullPath = join(fullPath, part);
    const entry = inspectWorkingEntry(fullPath, parts.slice(0, index + 1).join("/"));
    if (!entry) return;
    if (index < parts.length - 1 && !entry.isDirectory()) {
      throw new Error(`Expected a directory while opening ${JSON.stringify(path)}.`);
    }
  }
  return readLocalDocument(fullPath, path, archiveHeaderOnly, consumeBytes);
}

export function readWorkingTree(cwd: string) {
  const root = realpathSync.native(cwd);
  const snapshot: SnapshotFiles = { bytes: 0, files: new Map() };
  walkWorkingVault(root, true, (path, fullPath) => {
    record(snapshot, path, readLocalDocument(fullPath, path, path.startsWith(archivePrefix)));
  });
  return { kind: "working-tree" as const, files: snapshot.files };
}

export function readGit(cwd: string, args: string[], maxBuffer: number, detail: string): Buffer {
  try {
    return execFileSync("git", ["--no-pager", ...args], {
      cwd, maxBuffer, timeout: gitTimeout, env: gitEnvironment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
  } catch {
    throw new Error(`Unable to ${detail}. Check the local repository and input limits.`);
  }
}

export function resolveCommit(cwd: string, ref: string): string {
  if (!ref || ref.length > 256 || ref.startsWith("-") || [...ref].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error("Invalid Git revision argument.");
  }
  const result = readGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], 1024, `resolve Git revision ${JSON.stringify(ref)}`);
  const sha = result.toString("ascii").trim();
  if (!objectId.test(sha)) throw new Error("Invalid resolved Git commit ID.");
  return sha;
}

export async function gitArchiveHeader(cwd: string, hash: string, path: string): Promise<string> {
  if (!objectId.test(hash)) throw new Error("Expected a resolved Git blob ID.");
  const child = spawn("git", ["cat-file", "blob", hash], {
    cwd, env: gitEnvironment, timeout: gitTimeout, stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
  });
  let failed = false;
  child.on("error", () => { failed = true; });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  let bytes = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout) {
      bytes = Buffer.concat([bytes, (chunk as Buffer).subarray(0, maxArchiveHeaderBytes + 1 - bytes.length)]);
      const header = archiveHeader(bytes.subarray(0, maxArchiveHeaderBytes), path, false);
      if (header !== undefined) return header;
      if (bytes.length > maxArchiveHeaderBytes) {
        throw new Error(`Archive frontmatter exceeds ${maxArchiveHeaderBytes} bytes in ${JSON.stringify(path)}.`);
      }
    }
    if ((await closed) !== 0 || failed) throw new Error(`Unable to read archive frontmatter in ${JSON.stringify(path)}.`);
    return archiveHeader(bytes, path, true) ?? "";
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
}

export function listGitVault(cwd: string, head: string, includeArchive: boolean): Map<string, { hash: string; size: number }> {
  if (!objectId.test(head)) throw new Error("Expected a resolved Git commit ID.");
  const listing = readGit(
    cwd,
    ["ls-tree", "-r", "-t", "-z", "-l", "--full-tree", head, "--", ...rootNotes, vaultDirectory],
    maxSnapshotBytes,
    "list the resolved head vault tree",
  );
  const archivePath = Buffer.from(archivePrefix.slice(0, -1));
  const archivedDescendant = Buffer.from(archivePrefix);
  const files = new Map<string, { hash: string; size: number }>();
  let entries = 0;
  let start = 0;
  while (start < listing.length) {
    const end = listing.indexOf(0, start);
    if (end === -1) throw new Error("Incomplete resolved head vault tree.");
    const row = listing.subarray(start, end);
    start = end + 1;
    const pathBytes = row.subarray(row.indexOf(9) + 1);
    if (!includeArchive && (pathBytes.equals(archivePath) || pathBytes.subarray(0, archivedDescendant.length).equals(archivedDescendant))) continue;
    const entry = unpackUtf8(row, "Git tree");
    const [, mode, type, hash, size, path] = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(-|[0-9]+)\t([\s\S]+)$/.exec(entry) ?? [];
    if (!mode || !type || !hash || !size || !path) throw new Error("Invalid entry in resolved head vault tree.");
    checkEntry(++entries, path);
    if (mode === "120000" || mode === "160000") {
      throw new Error(`Symbolic link or submodule in vault input: ${JSON.stringify(path)}.`);
    }
    if (type === "tree" && !rootNotes.includes(path)) continue;
    if (path !== vaultDirectory && !path.toLowerCase().endsWith(".md")) continue;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755") || path === vaultDirectory || !Number.isSafeInteger(Number(size))) {
      throw new Error(`Unexpected Git entry at ${JSON.stringify(path)}.`);
    }

    checkDocumentLimit(files.size + 1);
    if (files.has(path)) throw new Error(`Duplicate vault path ${JSON.stringify(path)}.`);
    files.set(path, { hash, size: Number(size) });
  }
  return files;
}

export async function readResolvedGitVault(cwd: string, head: string) {
  const snapshot: SnapshotFiles = { bytes: 0, files: new Map() };
  for (const [path, { hash, size }] of listGitVault(cwd, head, true)) {
    if (path.startsWith(archivePrefix)) {
      record(snapshot, path, await gitArchiveHeader(cwd, hash, path));
    } else {
      if (size > maxFileBytes) throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
      record(snapshot, path, unpackUtf8(readGit(cwd, ["cat-file", "blob", hash], maxFileBytes, `read ${JSON.stringify(path)}`), path));
    }
  }
  return snapshot.files;
}

export async function readGitSnapshot(cwd: string, baseRef: string, headRef: string) {
  const base = resolveCommit(cwd, baseRef);
  const head = resolveCommit(cwd, headRef);
  return { kind: "git" as const, base, head, files: await readResolvedGitVault(cwd, head) };
}
