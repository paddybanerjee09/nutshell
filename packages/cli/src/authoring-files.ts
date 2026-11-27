import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, opendirSync, openSync, readSync, realpathSync,
  rmdirSync, unlinkSync, writeSync, type BigIntStats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLiteralPath } from "@nutshell/core/vault";
import { archivePrefix, checkVaultDocumentPath, listWorkingVault, maxFileBytes, readWorkingVaultDocument } from "./vault-files.ts";

export type AuthoringEdit = { path: string; body: string; previousBody?: string };
type OwnedDirectory = { path: string; identity: BigIntStats };
type OwnedFile = OwnedDirectory & { bytes: Buffer };

const vault = "nutshell-vault";
const records = [".nutshell/entities", ".nutshell/changes"];
const recordRootEntries = new Set(["config.json", "entities", "changes"]);
const configPath = ".nutshell/config.json";
const recordPath = /^\.nutshell\/(?:entities|changes)\/[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.json$/u;
const windowsDevice = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
const maxPaths = 5_000;
const maxManagedBytes = 8 * 1024 * 1024;
const safetyFlags = (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

function literal(path: string) {
  if (typeof path !== "string" || !path.isWellFormed() || Buffer.byteLength(path) > 512 ||
      !isLiteralPath(path) || /[<>"|?*[\]{}]|%(?:00|2e|2f|5c)/iu.test(path)) return false;
  const parts = path.split("/");
  return parts.length <= 16 && parts.every((part) => !/[. ]$/u.test(part) &&
    !/^(?:\.git|git~1)$/iu.test(part) && !windowsDevice.test(part));
}

function filePath(path: string) {
  if (!literal(path)) throw new Error("Use a safe repository-relative file path.");
  if (path !== configPath && !recordPath.test(path)) checkVaultDocumentPath(path);
}

function directoryPath(path: string) {
  if (!literal(path) || (path !== ".nutshell" && !records.includes(path) && path !== vault &&
    !path.startsWith(vault + "/"))) {
    throw new Error("Use a safe managed repository directory.");
  }
}

function current(absolute: string) {
  return lstatSync(absolute, { bigint: true, throwIfNoEntry: false });
}

function sameIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameVersion(left: BigIntStats, right: BigIntStats) {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function inspect(absolute: string, path: string) {
  const entry = current(absolute);
  if (entry && (entry.isSymbolicLink() || realpathSync.native(absolute) !== absolute)) {
    throw new Error("Refusing a symbolic link or alias at " + JSON.stringify(path) + ".");
  }
  return entry;
}

function directory(root: string, path: string, owned?: OwnedDirectory[]): boolean {
  let absolute = root;
  for (const segment of path ? path.split("/") : []) {
    absolute = join(absolute, segment);
    let entry = inspect(absolute, path);
    if (!entry) {
      if (!owned) return false;
      if (owned.length >= maxPaths) throw new Error("Authoring created-directory limit exceeded.");
      mkdirSync(absolute);
      entry = inspect(absolute, path);
      if (!entry) throw new Error("A created directory moved before it could be used.");
      owned.push({ path: absolute, identity: entry });
    }
    if (!entry.isDirectory() || current(join(absolute, ".git"))) {
      throw new Error("Expected a managed directory without nested Git state at " + JSON.stringify(path) + ".");
    }
  }
  return true;
}

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function regular(entry: BigIntStats | undefined, path: string): asserts entry is BigIntStats {
  if (!entry?.isFile() || entry.nlink !== 1n) {
    throw new Error("Expected a regular, unlinked repository file at " + JSON.stringify(path) + ".");
  }
}

function readExact(file: number, absolute: string, path: string, expected: BigIntStats) {
  const opened = fstatSync(file, { bigint: true });
  regular(opened, path);
  if (!sameVersion(expected, opened)) throw new Error("Repository file changed: " + JSON.stringify(path) + ".");
  if (opened.size > BigInt(maxFileBytes)) throw new Error("Repository file is too large: " + JSON.stringify(path) + ".");
  const bytes = Buffer.alloc(Number(opened.size) + 1);
  let read = 0;
  while (read < bytes.length) {
    const count = readSync(file, bytes, read, bytes.length - read, read);
    if (count === 0) break;
    read += count;
  }
  const listed = inspect(absolute, path);
  regular(listed, path);
  if (read !== Number(opened.size) || !sameVersion(opened, listed) || !sameVersion(opened, fstatSync(file, { bigint: true }))) {
    throw new Error("Repository file changed: " + JSON.stringify(path) + ".");
  }
  return bytes.subarray(0, read);
}

function readManaged(root: string, path: string) {
  if (!directory(root, parentPath(path))) return;
  const absolute = join(root, ...path.split("/"));
  const entry = inspect(absolute, path);
  if (!entry) return;
  regular(entry, path);
  const file = openSync(absolute, constants.O_RDONLY | safetyFlags);
  try {
    return readExact(file, absolute, path, entry);
  } finally {
    closeSync(file);
  }
}

function readAuthoringText(root: string, path: string, decoder: TextDecoder) {
  if (path.startsWith(archivePrefix)) {
    const entry = inspect(join(root, ...path.split("/")), path);
    if (!entry) return;
    regular(entry, path);
    return readWorkingVaultDocument(root, path, () => {}, true);
  }
  const bytes = readManaged(root, path);
  if (!bytes) return;
  try {
    const text = decoder.decode(bytes);
    if (text.includes("\0")) throw new Error();
    return text;
  } catch {
    throw new Error("Expected UTF-8 text at " + JSON.stringify(path) + ".");
  }
}

function inspectRecordRoot(root: string) {
  if (!directory(root, ".nutshell")) return;
  const entries = opendirSync(join(root, ".nutshell"));
  try {
    for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
      if (!recordRootEntries.has(entry.name)) {
        throw new Error("Unexpected repository record entry " + JSON.stringify(".nutshell/" + entry.name) + ".");
      }
    }
  } finally {
    entries.closeSync();
  }
}

function addSourcePaths(root: string, tree: Map<string, string>) {
  let remaining = maxPaths;
  function visit(path: string) {
    if (remaining-- <= 0 || tree.size >= maxPaths || !literal(path)) return;
    const absolute = join(root, ...path.split("/"));
    const stat = current(absolute);
    if (!stat || stat.isSymbolicLink() || realpathSync.native(absolute) !== absolute) return;
    if (stat.isDirectory() && !current(join(absolute, ".git"))) {
      const entries = opendirSync(absolute);
      try {
        for (let entry = entries.readSync(); entry && remaining > 0; entry = entries.readSync()) visit(path + "/" + entry.name);
      } finally {
        entries.closeSync();
      }
    } else if (path !== "src" && stat.isFile()) {
      tree.set(path, "");
    }
  }
  visit("src");
}

export function readAuthoringTree(cwd: string): Map<string, string> {
  const root = realpathSync.native(cwd);
  const managed = new Map<string, string>();
  let total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  function read(path: string) {
    filePath(path);
    const text = readAuthoringText(root, path, decoder);
    if (text === undefined) return;
    total += Buffer.byteLength(text);
    if (managed.size >= maxPaths || total > maxManagedBytes) throw new Error("Repository authoring input exceeds its limits.");
    managed.set(path, text);
  }

  inspectRecordRoot(root);
  for (const path of listWorkingVault(root, true)) read(path);
  read(configPath);
  for (const path of records) {
    if (!directory(root, path)) continue;
    const entries = opendirSync(join(root, ...path.split("/")));
    try {
      for (let entry = entries.readSync(); entry; entry = entries.readSync()) read(path + "/" + entry.name);
    } finally {
      entries.closeSync();
    }
  }
  addSourcePaths(root, managed);
  return new Map([...managed].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

export function missingAuthoringDirectories(cwd: string, paths: readonly string[]): string[] {
  const root = realpathSync.native(cwd);
  if (paths.length > maxPaths) throw new Error("Too many managed directories.");
  return [...new Set(paths)].filter((path) => {
    directoryPath(path);
    return !directory(root, path);
  }).sort();
}

function editBytes(body: string) {
  if (typeof body !== "string" || !body.isWellFormed() || body.includes("\0") || Buffer.byteLength(body) > maxFileBytes) {
    throw new Error("Authoring writes require bounded UTF-8 text.");
  }
  return Buffer.from(body);
}

function undoDirectory({ path, identity }: OwnedDirectory) {
  try {
    const listed = inspect(path, path);
    if (listed?.isDirectory() && sameIdentity(listed, identity)) rmdirSync(path);
  } catch {
    // Leave a changed or occupied directory in place.
  }
}

function undoFile({ path, identity, bytes }: OwnedFile) {
  try {
    const listed = inspect(path, path);
    if (!listed?.isFile() || listed.size !== BigInt(bytes.length) || !sameVersion(listed, identity)) return;
    const handle = openSync(path, constants.O_RDONLY | safetyFlags);
    let matches: boolean;
    try {
      matches = readExact(handle, path, path, listed).equals(bytes);
    } finally {
      closeSync(handle);
    }
    const checked = current(path);
    if (matches && checked && sameVersion(checked, listed)) unlinkSync(path);
  } catch {
    // Preserve files whose contents or ownership can no longer be confirmed.
  }
}

function localLock(root: string): OwnedDirectory {
  const key = createHash("sha256").update(process.platform === "win32" ? root.toLowerCase() : root).digest("hex");
  const path = join(realpathSync.native(tmpdir()), "nutshell-authoring-" + key);
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error("Another Nutshell authoring operation holds " + JSON.stringify(path) +
        ". Confirm that no authoring process is active before removing a stale lock.", { cause: error });
    }
    throw error;
  }
  return { path, identity: lstatSync(path, { bigint: true }) };
}

export function applyAuthoringEdits(cwd: string, edits: readonly AuthoringEdit[], directories: readonly string[] = []): void {
  const root = realpathSync.native(cwd);
  if (edits.length > maxPaths || directories.length > maxPaths) throw new Error("Authoring plan exceeds its path limits.");
  const seen = new Set<string>();
  let size = 0;
  const planned = edits.map(({ path, body, previousBody }) => {
    filePath(path);
    const canonical = path.toLowerCase();
    if (seen.has(canonical)) throw new Error("Duplicate authoring path " + JSON.stringify(path) + ".");
    seen.add(canonical);
    const bytes = editBytes(body);
    size += bytes.length;
    if (size > maxManagedBytes) throw new Error("Authoring plan exceeds its byte limit.");
    if (previousBody === undefined) return { path, bytes };
    const before = editBytes(previousBody);
    if (path !== "AGENTS.md" || !body.startsWith(previousBody)) {
      throw new Error("An existing AGENTS.md may only be extended by an exact suffix.");
    }
    return { path, bytes, before };
  });
  const targetDirectories = [...new Set([...directories, ...planned.map(({ path }) => parentPath(path)).filter(Boolean)])];
  for (const path of targetDirectories) {
    directoryPath(path);
    for (let ancestor = path; ancestor; ancestor = parentPath(ancestor)) {
      if (seen.has(ancestor.toLowerCase())) throw new Error("An authoring path cannot be both a file and a directory.");
    }
  }
  if (!planned.length && !targetDirectories.length) return;

  const lock = localLock(root);
  const ownedDirectories: OwnedDirectory[] = [];
  const ownedFiles: OwnedFile[] = [];
  let appendStarted = false;
  try {
    for (const path of targetDirectories) directory(root, path);
    for (const { path, before } of planned) {
      if (before) {
        if (!readManaged(root, path)?.equals(before)) throw new Error("AGENTS.md changed after the authoring plan was prepared.");
      } else if (inspect(join(root, ...path.split("/")), path)) {
        throw new Error("Authoring will not overwrite " + JSON.stringify(path) + ".");
      }
    }

    for (const path of targetDirectories) directory(root, path, ownedDirectories);
    for (const { path, bytes, before } of planned) {
      if (before) continue;
      if (!directory(root, parentPath(path))) throw new Error("The managed parent directory moved.");
      const absolute = join(root, ...path.split("/"));
      const file = openSync(absolute, constants.O_RDWR | constants.O_EXCL | constants.O_CREAT | constants.O_APPEND | safetyFlags, 0o666);
      try {
        const identity = fstatSync(file, { bigint: true });
        const listed = inspect(absolute, path);
        regular(listed, path);
        if (!sameVersion(identity, listed) || identity.size !== 0n) throw new Error("A created file changed before it could be written.");
        const owned = { path: absolute, identity, bytes: Buffer.alloc(0) };
        ownedFiles.push(owned);
        const written = writeSync(file, bytes);
        owned.bytes = bytes.subarray(0, written);
        const updated = fstatSync(file, { bigint: true });
        if (!readExact(file, absolute, path, updated).equals(owned.bytes)) throw new Error("A created file changed while writing.");
        owned.identity = updated;
        if (written !== bytes.length) throw new Error("Could not write " + JSON.stringify(path) + ".");
      } finally {
        closeSync(file);
      }
    }

    const append = planned.find(({ before }) => before !== undefined);
    if (append?.before) {
      const absolute = join(root, append.path);
      const entry = inspect(absolute, append.path);
      regular(entry, append.path);
      const file = openSync(absolute, constants.O_RDWR | constants.O_APPEND | safetyFlags);
      try {
        if (!readExact(file, absolute, append.path, entry).equals(append.before)) {
          throw new Error("AGENTS.md changed after the authoring plan was prepared.");
        }
        const suffix = append.bytes.subarray(append.before.length);
        if (suffix.length) {
          // The last mutation is append-only. If its outcome is uncertain, keep the prepared scaffold.
          appendStarted = true;
          if (writeSync(file, suffix) !== suffix.length) throw new Error("AGENTS.md may contain a partial append. Inspect it before retrying.");
          const updated = fstatSync(file, { bigint: true });
          if (!readExact(file, absolute, append.path, updated).equals(append.bytes)) {
            throw new Error("AGENTS.md changed during the append. Inspect it before retrying.");
          }
        }
      } finally {
        closeSync(file);
      }
    }
  } catch (error) {
    if (!appendStarted) {
      for (const file of ownedFiles.reverse()) undoFile(file);
      for (const folder of ownedDirectories.reverse()) undoDirectory(folder);
    }
    throw error;
  } finally {
    undoDirectory(lock);
  }
}
