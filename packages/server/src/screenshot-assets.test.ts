import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.ts";
import * as store from "./local-screenshot-store.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { canUploadScreenshotAsset, readScreenshotAsset, recordFixtureScreenshotCapture, uploadScreenshotAsset } from "./screenshot-assets.ts";
import { migrateAndSeed } from "./setup.ts";

const repositoryId = 1001;
const repositoryKey = String(repositoryId);
const installationId = 2001;

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("private PostgreSQL screenshot assets", { timeout: 30_000 }, () => {
  const assets: string[] = [];
  const sessions: string[] = [];
  let db: pg.Pool;
  let origin: string;
  let image: { mimeType: string; bytes: Buffer };

  beforeAll(async () => {
    const config = loadConfig();
    await migrateAndSeed(config.databaseUrl);
    origin = config.origin;
    db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 15_000 });
    const bytes = await sharp({ create: { width: 24, height: 18, channels: 4, background: "#aa34ac" } }).png().toBuffer();
    image = { mimeType: "image/png", bytes };
  }, 20_000);

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      const { rows } = await db.query<{ storage_key: string }>(
        "DELETE FROM screenshot_asset WHERE repository_id = $1 AND id = ANY($2) RETURNING storage_key", [repositoryId, assets]);
      for (const { storage_key } of rows) {
        try {
          await store.removeLocalScreenshot(storage_key);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
    } finally {
      await db.end();
    }
  }, 20_000);

  async function login(persona: "coordinator" | "reader" | "other") {
    const response = await getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ persona }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    const headers = new Headers({ Cookie: cookie!.split(";", 1)[0]! });
    const sessionId = (await getSession(headers))?.session.id;
    if (sessionId) sessions.push(sessionId);
    return headers;
  }

  it("requires current read/write grants and verifies private bytes, including metadata-only reads", async () => {
    const writer = await login("coordinator");
    const reader = await login("reader");
    const other = await login("other");
    expect(await canUploadScreenshotAsset(writer, repositoryKey)).toBe(true);
    expect(await canUploadScreenshotAsset(reader, repositoryKey)).toBe(false);
    expect(await uploadScreenshotAsset(reader, repositoryKey, image)).toEqual({ status: "forbidden" });
    expect(await uploadScreenshotAsset(other, repositoryKey, image)).toEqual({ status: "unavailable" });
    expect(await uploadScreenshotAsset(writer, repositoryKey, { ...image, mimeType: "image/jpeg" })).toMatchObject({ status: "invalid" });
    expect(await uploadScreenshotAsset(writer, repositoryKey, { ...image, declaration: { provenance: "fixture_capture" } }))
      .toMatchObject({ status: "invalid" });

    const result = await uploadScreenshotAsset(writer, repositoryKey, image);
    if (result.status !== "ready") throw new Error("Expected the manual upload to succeed.");
    const { asset } = result;
    assets.push(asset.id);
    expect(asset).toMatchObject({ mimeType: "image/png", width: 24, height: 18, declaration: null, provenance: "declared", captureRef: null });
    expect(asset).not.toHaveProperty("storageKey");
    expect(asset).not.toHaveProperty("creatorId");
    const { rows } = await db.query<{ storage_key: string }>("SELECT storage_key FROM screenshot_asset WHERE id = $1", [asset.id]);
    const key = rows[0]!.storage_key;
    const path = join(".local", "media", "verify", key);
    const stored = await readFile(path);
    expect(stored.length).toBe(asset.byteLength);
    expect(store.screenshotDigest(stored)).toBe(asset.sha256);

    await closeRuntime();
    expect(await readScreenshotAsset(reader, repositoryKey, asset.id)).toEqual({ status: "ready", asset });
    expect(await readScreenshotAsset(reader, repositoryKey, asset.id, { includeBytes: true })).toEqual({ status: "ready", asset, bytes: stored });
    expect(await readScreenshotAsset(other, "1002", asset.id)).toEqual({ status: "unavailable" });
    expect(await readScreenshotAsset(other, repositoryKey, asset.id)).toEqual({ status: "unavailable" });
    expect(await readScreenshotAsset(new Headers(), repositoryKey, asset.id)).toEqual({ status: "unavailable" });
    expect(await readScreenshotAsset(reader, repositoryKey, key)).toEqual({ status: "unavailable" });
    expect(await readScreenshotAsset(reader, repositoryKey, "asset_" + randomUUID())).toEqual({ status: "unavailable" });

    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    try {
      expect(await readScreenshotAsset(writer, repositoryKey, asset.id, { includeBytes: true })).toEqual({ status: "unavailable" });
      expect(await uploadScreenshotAsset(writer, repositoryKey, image)).toEqual({ status: "unavailable" });
    } finally {
      await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    }
    expect(await readScreenshotAsset(reader, repositoryKey, asset.id)).toEqual({ status: "ready", asset });

    const corrupted = Buffer.from(stored);
    corrupted[0] = corrupted[0]! ^ 1;
    await writeFile(path, corrupted);
    expect(await readScreenshotAsset(reader, repositoryKey, asset.id)).toEqual({ status: "unavailable" });
    await store.removeLocalScreenshot(key);
    expect(await readScreenshotAsset(reader, repositoryKey, asset.id, { includeBytes: true })).toEqual({ status: "unavailable" });
  });

  it("rolls back a failed file write and refuses unobserved capture claims", async () => {
    const writer = await login("coordinator");
    async function count() {
      return (await db.query<{ count: string }>("SELECT count(*) FROM screenshot_asset WHERE repository_id = $1", [repositoryId])).rows[0]?.count;
    }
    const before = await count();
    const write = vi.spyOn(store, "writeLocalScreenshot").mockRejectedValueOnce(new Error("Simulated write failure."));
    try {
      await expect(uploadScreenshotAsset(writer, repositoryKey, image)).rejects.toThrow("Simulated write failure.");
    } finally {
      write.mockRestore();
    }
    expect(await count()).toBe(before);

    const declaration = {
      sourceRevision: "f".repeat(40), route: "/app/repos/1001/workspace", state: "workspace-indexed",
      viewport: { width: 24, height: 18 }, environment: "local-alpha", capturedAt: "2026-11-27T00:00:00Z",
    };
    expect(await recordFixtureScreenshotCapture(writer, repositoryKey, { ...image, declaration: { ...declaration, route: "//localhost" } }))
      .toMatchObject({ status: "invalid" });
    expect(await recordFixtureScreenshotCapture(writer, repositoryKey, { ...image, declaration })).toMatchObject({ status: "invalid" });
    expect(await count()).toBe(before);

    const result = await uploadScreenshotAsset(writer, repositoryKey, { ...image, declaration });
    if (result.status !== "ready") throw new Error("Expected the claimed source to remain a declaration.");
    assets.push(result.asset.id);
    expect(result.asset).toMatchObject({ provenance: "declared", captureRef: null, declaration });
  });
});
