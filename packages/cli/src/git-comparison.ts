import { openGitBlobs } from "./context-source.ts";
import { archivePrefix, checkVaultDocumentPath, gitArchiveHeader, maxFileBytes, readGit, readResolvedGitVault, resolveCommit, unpackUtf8 } from "./vault-files.ts";

const rootNotes = new Set(["AGENTS.md", "README.md", "SPEC.md"]);
const maxTreePaths = 5_000;
const maxGitOutputBytes = 8 * 1024 * 1024;
const maxManagedBytes = 8 * 1024 * 1024;
const maxPathBytes = 512;
const treeRow = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(-|[0-9]+)\t([\s\S]+)$/u;

type CommitTree = { files: Map<string, string>; managed: Map<string, { hash: string; size: number }> };

function nulRecords(bytes: Buffer, detail: string) {
  if (bytes.length === 0) return [];
  const text = unpackUtf8(bytes, detail);
  if (!text.endsWith("\0")) throw new Error(`Incomplete ${detail}.`);
  return text.slice(0, -1).split("\0");
}

function tree(cwd: string, revision: string): CommitTree {
  const rows = nulRecords(readGit(cwd, ["ls-tree", "-r", "-t", "-z", "-l", "--full-tree", revision], maxGitOutputBytes,
    "list the immutable repository tree"), "Git repository tree");
  const files = new Map<string, string>();
  const managed = new Map<string, { hash: string; size: number }>();
  for (const row of rows) {
    const [, mode, type, hash, size, path] = treeRow.exec(row) ?? [];
    if (!mode || !type || !hash || !size || !path) throw new Error("Invalid entry in immutable Git tree.");
    if (Buffer.byteLength(path) > maxPathBytes) throw new Error("Repository path exceeds the byte limit.");
    const note = rootNotes.has(path) || (path.startsWith("nutshell-vault/") && /\.md$/iu.test(path));
    const records = path.startsWith(".nutshell/");
    const directory = path === "nutshell-vault" || path === ".nutshell";
    const protectedPath = directory || records || note || path.startsWith("nutshell-vault/");
    if (protectedPath && (mode === "120000" || mode === "160000")) {
      throw new Error(`Symbolic link or submodule in repository policy input: ${JSON.stringify(path)}.`);
    }
    if (type === "tree" && !rootNotes.has(path)) continue;
    if (directory) throw new Error(`Expected a directory at ${JSON.stringify(path)}.`);
    if (files.size >= maxTreePaths) throw new Error(`Repository input exceeds ${maxTreePaths} paths.`);
    if (files.has(path)) throw new Error(`Duplicate Git path ${JSON.stringify(path)}.`);
    files.set(path, "");
    if (!records && !note) continue;
    if (note) checkVaultDocumentPath(path);
    const byteLength = Number(size);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755") || !Number.isSafeInteger(byteLength)) {
      throw new Error(`Expected a regular Git file at ${JSON.stringify(path)}.`);
    }
    managed.set(path, { hash, size: byteLength });
  }
  return { files, managed };
}

async function materialize(cwd: string, input: CommitTree, batch: ReturnType<typeof openGitBlobs>) {
  let bytes = 0;
  for (const [path, blob] of input.managed) {
    const archived = path.startsWith(archivePrefix);
    if (!archived && blob.size > maxFileBytes) throw new Error(`Managed file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
    if (!archived && bytes + blob.size > maxManagedBytes) throw new Error(`Managed input exceeds ${maxManagedBytes} bytes.`);
    const contents = archived ? await gitArchiveHeader(cwd, blob.hash, path) : await batch.read(blob, path);
    bytes += Buffer.byteLength(contents);
    if (bytes > maxManagedBytes) throw new Error(`Managed input exceeds ${maxManagedBytes} bytes.`);
    input.files.set(path, contents);
  }
  return input.files;
}

function changedPaths(cwd: string, base: string, head: string) {
  const listing = readGit(cwd, ["diff-tree", "--no-commit-id", "-r", "--name-only", "-z", "--no-renames", "--no-ext-diff", "--no-textconv",
    "--no-relative", "--ignore-submodules=none", base, head, "--"], maxGitOutputBytes, "compare the immutable Git revisions");
  const paths = nulRecords(listing, "Git changed-path list");
  if (paths.length > 2 * maxTreePaths || paths.some((path) => !path || Buffer.byteLength(path) > maxPathBytes)) {
    throw new Error("Changed-path input exceeds the repository limits.");
  }
  return Array.from(new Set(paths)).sort();
}

function hasRecords(cwd: string, revision: string) {
  return readGit(cwd, ["ls-tree", "-z", "--name-only", "--full-tree", revision, "--", ".nutshell"], 1024,
    "inspect the immutable repository policy directory").length > 0;
}

export async function readGitComparison(cwd: string, baseRef: string, headRef: string, allowVaultOnly: boolean) {
  const base = resolveCommit(cwd, baseRef);
  const head = resolveCommit(cwd, headRef);
  const source = { kind: "git" as const, base, head };
  if (allowVaultOnly && !hasRecords(cwd, base) && (head === base || !hasRecords(cwd, head))) {
    return { kind: "vault" as const, source, files: await readResolvedGitVault(cwd, head) };
  }

  const paths = changedPaths(cwd, base, head);
  const baseTree = tree(cwd, base);
  const headTree = head === base ? baseTree : tree(cwd, head);
  const batch = openGitBlobs(cwd);
  try {
    const baseFiles = await materialize(cwd, baseTree, batch);
    const headFiles = headTree === baseTree ? baseFiles : await materialize(cwd, headTree, batch);
    return { kind: "repository" as const, source, baseFiles, headFiles, changedPaths: paths };
  } finally {
    await batch.close();
  }
}
