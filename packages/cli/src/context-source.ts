import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import type { VaultContextSource } from "@nutshell/core/context-retrieval";
import {
  archivePrefix,
  checkVaultDocumentPath,
  gitEnvironment,
  gitTimeout,
  listGitVault,
  listWorkingVault,
  maxFileBytes,
  maxSnapshotBytes,
  readWorkingVaultDocument,
  resolveCommit,
  unpackUtf8,
} from "./vault-files.ts";

type Selection = { kind: "working-tree" } | { kind: "git"; ref: string };
type GitBlob = { hash: string; size: number };

function openGitBlobs(cwd: string) {
  const child = spawn("git", ["cat-file", "--batch"], {
    cwd, env: gitEnvironment, stdio: ["pipe", "pipe", "ignore"], windowsHide: true,
  });
  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
  child.stdin.on("error", () => child.stdout.destroy());
  const chunks = child.stdout[Symbol.asyncIterator]();
  let pending = Promise.resolve();
  let stopped = false;

  function stop() {
    stopped = true;
    child.stdin.destroy();
    child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    child.unref();
  }

  async function request({ hash, size }: GitBlob, path: string): Promise<string> {
    if (stopped) throw new Error("The Git vault reader has stopped.");
    const failure = `Unable to read Git vault document ${JSON.stringify(path)}.`;
    // ls-tree has already supplied the object ID and size. No caller path is passed to cat-file.
    const header = Buffer.from(`${hash} blob ${size}\n`, "ascii");
    const response = Buffer.alloc(header.length + size + 1);
    const timeout = setTimeout(stop, gitTimeout);
    try {
      child.stdin.write(hash + "\n");
      let received = 0;
      while (received < response.length) {
        const { value, done } = await chunks.next();
        if (done || value.length > response.length - received) throw new Error(failure);
        received += (value as Buffer).copy(response, received);
        const headerBytes = Math.min(received, header.length);
        if (!response.subarray(0, headerBytes).equals(header.subarray(0, headerBytes))) throw new Error(failure);
      }
      if (response.at(-1) !== 10) throw new Error(failure);
    } catch {
      stop();
      throw new Error(failure);
    } finally {
      clearTimeout(timeout);
    }
    return unpackUtf8(response.subarray(header.length, -1), path);
  }

  return {
    read(blob: GitBlob, path: string) {
      const output = pending.then(() => request(blob, path));
      pending = output.then(() => {}, () => {});
      return output;
    },
    async close() {
      if (stopped) return;
      stopped = true;
      child.stdin.end();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const completed = await Promise.race([exited, new Promise<false>((resolve) => {
          timeout = setTimeout(() => resolve(false), 2_000);
        })]);
        if (!completed) stop();
      } finally {
        clearTimeout(timeout);
        child.stdout.destroy();
      }
    },
  };
}

export async function createContextSource(cwd: string, selection: Selection): Promise<VaultContextSource & { close(): Promise<void> }> {
  const root = realpathSync.native(cwd);
  const revision = selection.kind === "git" ? resolveCommit(root, selection.ref) : "working-tree";
  const cache = new Map<string, Promise<string | undefined>>();
  const workingLists = new Map<boolean, readonly string[]>();
  const gitLists = new Map<boolean, Map<string, GitBlob>>();
  let bytes = 0;
  let batch: ReturnType<typeof openGitBlobs> | undefined;
  let closed = false;

  function gitFiles(includeArchive: boolean) {
    let files = gitLists.get(includeArchive);
    if (!files) {
      files = listGitVault(root, revision, includeArchive);
      gitLists.set(includeArchive, files);
    }
    return files;
  }

  function consumeBytes(count: number) {
    bytes += count;
    if (bytes > maxSnapshotBytes) throw new Error(`Vault input exceeds ${maxSnapshotBytes} bytes.`);
  }

  async function readDocument(path: string) {
    if (selection.kind === "working-tree") {
      return readWorkingVaultDocument(root, path, consumeBytes);
    }
    const blob = gitFiles(path.startsWith(archivePrefix)).get(path);
    if (!blob) return;
    if (blob.size > maxFileBytes) throw new Error(`Vault file exceeds ${maxFileBytes} bytes: ${JSON.stringify(path)}.`);
    consumeBytes(blob.size);
    batch ??= openGitBlobs(root);
    return batch.read(blob, path);
  }

  return {
    kind: selection.kind,
    revision,
    async read(path) {
      if (closed) throw new Error("The vault context source is closed.");
      checkVaultDocumentPath(path);
      let result = cache.get(path);
      if (!result) {
        result = readDocument(path);
        cache.set(path, result);
      }
      return result;
    },
    async listPaths(includeArchive) {
      if (closed) throw new Error("The vault context source is closed.");
      if (selection.kind === "git") return [...gitFiles(includeArchive).keys()].sort();
      let paths = workingLists.get(includeArchive);
      if (!paths) {
        paths = listWorkingVault(root, includeArchive);
        workingLists.set(includeArchive, paths);
      }
      return paths;
    },
    async close() {
      closed = true;
      await batch?.close();
    },
  };
}
