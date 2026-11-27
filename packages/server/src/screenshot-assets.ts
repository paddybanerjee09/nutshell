import { randomUUID } from "node:crypto";
import { repositoryChangeSchema } from "@nutshell/core/snapshot";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { fixturePolicyVersion, fixtureSchemaVersion, isFixtureRevision, withFixtureRepositoryAccess } from "./fixture-sync.ts";
import { readLocalScreenshot, screenshotDigest, writeLocalScreenshot } from "./local-screenshot-store.ts";
import { InvalidRasterError, sanitizeRaster } from "./raster.ts";
import { fixtureState, screenshotAsset } from "./schema.ts";

const evidence = repositoryChangeSchema.shape.evidence.element.shape;
const declarationSchema = z.strictObject({
  sourceRevision: z.string().refine(isFixtureRevision),
  route: evidence.route.refine((value) => value.isWellFormed()),
  state: evidence.state.refine((value) => value.isWellFormed() && !/\p{Cc}/u.test(value)),
  viewport: evidence.viewport,
  environment: evidence.environment.refine((value) => value.isWellFormed() && !/\p{Cc}/u.test(value)),
  capturedAt: z.string().max(40).pipe(evidence.captured_at).optional(),
});
const assetIdPattern = /^asset_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type ScreenshotDeclaration = z.infer<typeof declarationSchema>;
type StoredScreenshot = typeof screenshotAsset.$inferSelect;
export type ScreenshotAsset = Pick<StoredScreenshot,
  "id" | "mimeType" | "byteLength" | "sha256" | "width" | "height" | "provenance" | "declaration" | "captureRef"> & { createdAt: string };

type UploadInput = { mimeType: string; bytes: Uint8Array; declaration?: unknown };
type Unavailable = { status: "unavailable" };
type UploadResult = { status: "ready"; asset: ScreenshotAsset } | { status: "forbidden" } |
  Unavailable | { status: "invalid"; message: string };
type ReadResult = { status: "ready"; asset: ScreenshotAsset; bytes?: Buffer } | Unavailable;

function serializeAsset(row: StoredScreenshot): ScreenshotAsset {
  const { id, mimeType, byteLength, sha256, width, height, provenance, declaration, captureRef, createdAt } = row;
  return { id, mimeType, byteLength, sha256, width, height, provenance, declaration, captureRef, createdAt: createdAt.toISOString() };
}

export async function canUploadScreenshotAsset(headers: Headers, repositoryId: string): Promise<boolean> {
  return await withFixtureRepositoryAccess(headers, repositoryId, async (scope) => scope.canWrite) ?? false;
}

export async function uploadScreenshotAsset(headers: Headers, repositoryId: string, input: UploadInput): Promise<UploadResult> {
  return persistScreenshot(headers, repositoryId, input, "declared");
}

export async function recordFixtureScreenshotCapture(headers: Headers, repositoryId: string, input: UploadInput): Promise<UploadResult> {
  if (process.env.NUTSHELL_VERIFY !== "1") return { status: "unavailable" };
  const config = loadConfig();
  if (config.mode !== "local-alpha" || config.databaseUrl !== config.testDatabaseUrl || new URL(config.origin).hostname !== "127.0.0.1") {
    return { status: "unavailable" };
  }
  return persistScreenshot(headers, repositoryId, input, "fixture_capture");
}

async function persistScreenshot(
  headers: Headers, repositoryId: string, input: UploadInput, provenance: ScreenshotAsset["provenance"],
): Promise<UploadResult> {
  return await withFixtureRepositoryAccess<UploadResult>(headers, repositoryId, async ({ tx, repositoryId: id, userId, canWrite, epoch }) => {
    if (!canWrite) return { status: "forbidden" };
    const parsed = declarationSchema.nullish().safeParse(input.declaration);
    if (!parsed.success) return { status: "invalid", message: "Provide valid screenshot declaration fields." };
    const declaration = parsed.data ?? null;
    const controlledCapture = provenance === "fixture_capture";
    if (controlledCapture) {
      if (!declaration?.capturedAt || declaration.route !== "/app/repos/" + id + "/workspace" ||
        declaration.state !== "workspace-indexed" || declaration.environment !== "local-alpha") {
        return { status: "invalid", message: "The capture must use the indexed local fixture workspace." };
      }
      const [current] = await tx.select({ revision: fixtureState.headRevision }).from(fixtureState).where(and(
        eq(fixtureState.repositoryId, id), eq(fixtureState.indexedEpoch, epoch),
        eq(fixtureState.headRevision, declaration.sourceRevision), eq(fixtureState.indexedRevision, declaration.sourceRevision),
        eq(fixtureState.indexedSchemaVersion, fixtureSchemaVersion), eq(fixtureState.indexedPolicyVersion, fixturePolicyVersion),
      ));
      if (!current) return { status: "invalid", message: "The capture source must be the current indexed fixture revision." };
    }

    let image: Awaited<ReturnType<typeof sanitizeRaster>>;
    try {
      image = await sanitizeRaster(input.bytes, input.mimeType);
    } catch (error) {
      if (error instanceof InvalidRasterError) return { status: "invalid", message: error.message };
      throw error;
    }
    if (controlledCapture && (declaration?.viewport.width !== image.width || declaration?.viewport.height !== image.height)) {
      return { status: "invalid", message: "The fixture capture dimensions must match its viewport." };
    }

    const storageKey = randomUUID();
    const [created] = await tx.insert(screenshotAsset).values({
      id: "asset_" + randomUUID(), repositoryId: id, creatorId: userId, storageKey,
      mimeType: image.mimeType, byteLength: image.bytes.length, sha256: screenshotDigest(image.bytes),
      width: image.width, height: image.height, provenance, declaration,
      captureRef: controlledCapture ? "capture_" + randomUUID() : null,
    }).returning();
    if (!created) throw new Error("The screenshot metadata could not be stored.");

    // The pending row stays invisible until the exclusive private file is complete and flushed.
    await writeLocalScreenshot(storageKey, image.bytes);
    return { status: "ready", asset: serializeAsset(created) };
  }) ?? { status: "unavailable" };
}

export async function readScreenshotAsset(
  headers: Headers, repositoryId: string, assetId: string, { includeBytes = false }: { includeBytes?: boolean } = {},
): Promise<ReadResult> {
  if (!assetIdPattern.test(assetId)) return { status: "unavailable" };
  return await withFixtureRepositoryAccess<ReadResult>(headers, repositoryId, async ({ tx, repositoryId: id }) => {
    const [row] = await tx.select().from(screenshotAsset)
      .where(and(eq(screenshotAsset.repositoryId, id), eq(screenshotAsset.id, assetId)));
    if (!row) return { status: "unavailable" };
    const bytes = await readLocalScreenshot(row.storageKey, row.byteLength, row.sha256);
    if (!bytes) return { status: "unavailable" };
    const asset = serializeAsset(row);
    return includeBytes ? { status: "ready", asset, bytes } : { status: "ready", asset };
  }) ?? { status: "unavailable" };
}
