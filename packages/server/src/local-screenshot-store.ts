import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join, relative } from "node:path";
import { maxRasterOutputBytes } from "./raster.ts";

const storageKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

async function storagePath(key: string, create: boolean) {
  if (!storageKeyPattern.test(key)) throw new Error("Invalid screenshot storage locator.");
  let directory = await realpath(".");
  for (const part of [".local", "media", process.env.NUTSHELL_VERIFY === "1" ? "verify" : "alpha"]) {
    // The private store is runtime state. Keep it out of the build's file trace.
    const child = join(/* turbopackIgnore: true */ directory, part);
    if (create) await mkdir(child, { recursive: true, mode: 0o700 });
    const info = await lstat(child);
    if (!info.isDirectory() || info.isSymbolicLink() || relative(child, await realpath(/* turbopackIgnore: true */ child)) !== "") {
      throw new Error("Local screenshot storage must use private directories within the checkout.");
    }
    directory = child;
  }
  return join(directory, key);
}

export function screenshotDigest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function removeLocalScreenshot(key: string) {
  const path = await storagePath(key, false);
  await unlink(path);
}

export async function writeLocalScreenshot(key: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > maxRasterOutputBytes) throw new Error("Invalid screenshot storage length.");
  const path = await storagePath(key, true);
  const handle = await open(path, "wx", 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
}

export async function readLocalScreenshot(key: string, byteLength: number, digest: string): Promise<Buffer | null> {
  if (!Number.isInteger(byteLength) || byteLength < 1 || byteLength > maxRasterOutputBytes || !/^[a-f0-9]{64}$/u.test(digest)) {
    return null;
  }
  try {
    const path = await storagePath(key, false);
    const expected = await lstat(path, { bigint: true });
    if (!expected.isFile() || expected.size !== BigInt(byteLength)) return null;
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const actual = await handle.stat({ bigint: true });
      if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size !== expected.size) return null;
      const bytes = Buffer.alloc(byteLength);
      let offset = 0;
      while (offset < byteLength) {
        const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, offset);
        if (bytesRead === 0) return null;
        offset += bytesRead;
      }
      if ((await handle.stat({ bigint: true })).size !== expected.size) return null;
      return screenshotDigest(bytes) === digest ? bytes : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
