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
const archivePrefix = `${vaultDirectory}/archive/`;
const maxEntries = 4096;
const maxDocuments = 512;
const maxFileBytes = 256 * 1024;
const maxArchiveHeaderBytes = 16 * 1024;
const maxSnapshotBytes = 4 * 1024 * 1024;
const gitTimeout = 15_000;
const gitEnvironment = { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1" };
const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type SnapshotFiles = {
  entries: number;
  bytes: number;
  files: Map<string, string>;
};

function unpackUtf8(bytes: Buffer, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid UTF-8 in ${JSON.stringify(path)}.`);
  }
}

function checkEntry(snapshot: SnapshotFiles, path: string): void {
  snapshot.entries += 1;
  if (snapshot.entries > maxEntries) throw new Error(`Vault input exceeds ${maxEntries} entries.`);
  const parts = path.split("/");
  if (parts.length > 16 || Buffer.byteLength(path) > 512) {
    throw new Error("Vault path exceeds the depth or byte limit.");
  }
  if (parts.some((part) => {
    return !part || part === "." || part === ".." || part.endsWith(".") || part.endsWith(" ")
      || /[\\:<>"|?*]/.test(part)
      || [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part);
  })) {
    throw new Error(`Unsafe vault path ${JSON.stringify(path)}.`);
  }
}

function record(snapshot: SnapshotFiles, path: string, contents: string): void {
  if (snapshot.files.has(path)) throw new Error(`Duplicate vault path ${JSON.stringify(path)}.`);
  snapshot.bytes += Buffer.byteLength(contents);
  if (snapshot.bytes > maxSnapshotBytes) throw new Error(`Vault input exceeds ${maxSnapshotBytes} bytes.`);
  snapshot.files.set(path, contents);
}

function checkDocumentLimit(snapshot: SnapshotFiles): void {
  if (snapshot.files.size >= maxDocuments) throw new Error(`Vault input exceeds ${maxDocuments} documents.`);
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

function readLocalDocument(fullPath: string, path: string): string {
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
    if (path.startsWith(archivePrefix)) return localArchiveHeader(file, path);
    if (opened.size > maxFileBytes) throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);

    const bytes = Buffer.alloc(maxFileBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(file, bytes, length, bytes.length - length, null);
      if (count === 0) return unpackUtf8(bytes.subarray(0, length), path);
      length += count;
    }
    throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
  } finally {
    closeSync(file);
  }
}

export function readWorkingTree(cwd: string) {
  const root = realpathSync.native(cwd);
  const snapshot: SnapshotFiles = { entries: 0, bytes: 0, files: new Map() };

  function readEntry(path: string): void {
    checkEntry(snapshot, path);
    const fullPath = join(root, ...path.split("/"));
    const entry = lstatSync(fullPath, { throwIfNoEntry: false });
    if (!entry) return;
    if (entry.isSymbolicLink()) throw new Error(`Symbolic link in vault input: ${JSON.stringify(path)}.`);

    if (entry.isDirectory() && (path === vaultDirectory || path.startsWith(`${vaultDirectory}/`))) {
      if (realpathSync.native(fullPath) !== fullPath) throw new Error(`Unsafe vault directory ${JSON.stringify(path)}.`);
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
      checkDocumentLimit(snapshot);
      if (path === vaultDirectory) throw new Error(`Expected a directory at ${JSON.stringify(path)}.`);
      record(snapshot, path, readLocalDocument(fullPath, path));
    }
  }

  for (const path of [...rootNotes, vaultDirectory]) readEntry(path);
  return { kind: "working-tree" as const, files: snapshot.files };
}

function readGit(cwd: string, args: string[], maxBuffer: number, detail: string): Buffer {
  try {
    return execFileSync("git", args, {
      cwd, maxBuffer, timeout: gitTimeout, env: gitEnvironment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
  } catch {
    throw new Error(`Unable to ${detail}. Check the local repository and vault input limits.`);
  }
}

function resolveCommit(cwd: string, ref: string): string {
  if (!ref || ref.length > 256 || ref.startsWith("-") || [...ref].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error("Invalid Git revision argument.");
  }
  const result = readGit(cwd, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], 1024, `resolve Git revision ${JSON.stringify(ref)}`);
  const sha = result.toString("ascii").trim();
  if (!objectId.test(sha)) throw new Error("Invalid resolved Git commit ID.");
  return sha;
}

async function gitArchiveHeader(cwd: string, hash: string, path: string): Promise<string> {
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

export async function readGitSnapshot(cwd: string, baseRef: string, headRef: string) {
  const base = resolveCommit(cwd, baseRef);
  const head = resolveCommit(cwd, headRef);
  const listing = readGit(
    cwd,
    ["ls-tree", "-r", "-t", "-z", "-l", "--full-tree", head, "--", ...rootNotes, vaultDirectory],
    maxSnapshotBytes,
    "list the resolved head vault tree",
  );
  const entries = unpackUtf8(listing, "Git tree").split("\0");
  if (entries.pop() !== "") throw new Error("Incomplete resolved head vault tree.");
  const snapshot: SnapshotFiles = { entries: 0, bytes: 0, files: new Map() };

  for (const entry of entries) {
    const [, mode, type, hash, size, path] = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(-|[0-9]+)\t([\s\S]+)$/.exec(entry) ?? [];
    if (!mode || !type || !hash || !size || !path) throw new Error("Invalid entry in resolved head vault tree.");
    checkEntry(snapshot, path);
    if (mode === "120000" || mode === "160000") {
      throw new Error(`Symbolic link or submodule in vault input: ${JSON.stringify(path)}.`);
    }
    if (type === "tree" && !rootNotes.includes(path)) continue;
    if (path !== vaultDirectory && !path.toLowerCase().endsWith(".md")) continue;
    if (type !== "blob" || (mode !== "100644" && mode !== "100755") || path === vaultDirectory) {
      throw new Error(`Unexpected Git entry at ${JSON.stringify(path)}.`);
    }

    checkDocumentLimit(snapshot);
    if (path.startsWith(archivePrefix)) {
      record(snapshot, path, await gitArchiveHeader(cwd, hash, path));
    } else {
      if (Number(size) > maxFileBytes) throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
      record(snapshot, path, unpackUtf8(readGit(cwd, ["cat-file", "blob", hash], maxFileBytes, `read ${JSON.stringify(path)}`), path));
    }
  }
  return { kind: "git" as const, base, head, files: snapshot.files };
}
