import { createHash } from "node:crypto";
import { isLiteralPath } from "@nutshell/core/vault";
import { and, eq, sql } from "drizzle-orm";
import { fixturePolicyVersion, fixtureSchemaVersion, isFixtureRevision, lockFixtureConnection } from "./fixture-sync.ts";
import { fixtureRepositories } from "./local-fixtures.ts";
import { getFixtureDatabase, lockRepositoryGrant, resolveRepositoryActor, type FixtureTransaction } from "./runtime.ts";
import { fixtureSnapshot, fixtureState, markdownDraft } from "./schema.ts";

export const maxFixtureDraftBytes = 256 * 1024;
export const maxFixtureDraftPathBytes = 512;
const maxExpectedVersion = 2_147_483_646;

export type FixtureMarkdownDraft = {
  path: string;
  markdown: string;
  sourceRevision: string;
  sourceBlob: string;
  version: number;
  updatedAt: string;
};

export type SaveFixtureDraftInput = Pick<FixtureMarkdownDraft, "path" | "markdown" | "sourceRevision" | "version">;

type AccessRejection = { status: "unavailable" | "forbidden" };
type DraftRejection = AccessRejection | { status: "invalid" };
type DraftConflict = { status: "conflict"; reason: "source" | "version"; currentRevision: string | null; draft: FixtureMarkdownDraft | null };
type ReadDraftResult = { status: "ready"; source: string; sourceRevision: string; draft: FixtureMarkdownDraft | null } | DraftConflict | DraftRejection;
type SaveDraftResult = { status: "saved"; draft: FixtureMarkdownDraft } | DraftConflict | DraftRejection;

export type DraftScope = { tx: FixtureTransaction; repositoryId: number; installationId: number; epoch: number; userId: string };
type StoredDraft = typeof markdownDraft.$inferSelect;

export function isFixtureDraftPath(path: string) {
  if (typeof path !== "string" || path.length > maxFixtureDraftPathBytes || !path.isWellFormed() ||
      Buffer.byteLength(path) > maxFixtureDraftPathBytes) return false;
  return path.startsWith("nutshell-vault/") && !path.startsWith("nutshell-vault/archive/") && /\.md$/iu.test(path) &&
    isLiteralPath(path) && path.split("/").every((segment) => segment.toLowerCase() !== ".git");
}

function validSave(input: SaveFixtureDraftInput) {
  return isFixtureDraftPath(input.path) && isFixtureRevision(input.sourceRevision) &&
    Number.isInteger(input.version) && input.version >= 0 && input.version <= maxExpectedVersion &&
    typeof input.markdown === "string" && input.markdown.length <= maxFixtureDraftBytes && input.markdown.isWellFormed() &&
    !input.markdown.includes("\0") && Buffer.byteLength(input.markdown) <= maxFixtureDraftBytes;
}

export async function withDraftAccess<Result>(
  headers: Headers, repositoryId: string, perform: (scope: DraftScope) => Promise<Result>, lock: "share" | "update" = "share",
): Promise<Result | AccessRejection> {
  const fixture = fixtureRepositories.find(({ id }) => String(id) === repositoryId);
  if (!fixture) return { status: "unavailable" };
  const actor = await resolveRepositoryActor(headers);
  if (!actor) return { status: "unavailable" };

  return getFixtureDatabase().transaction(async (tx) => {
    // Keep the provider head and epoch stable through the draft read/write. Draft writers still use per-row optimistic updates.
    const connection = await lockFixtureConnection(tx, fixture.id, fixture.installationId, lock);
    if (!connection) return { status: "unavailable" };
    const grant = await lockRepositoryGrant(tx, actor, fixture.id);
    if (!grant) return { status: "unavailable" };
    if (!grant.canWrite) return { status: "forbidden" };
    return perform({ tx, repositoryId: fixture.id, installationId: fixture.installationId, epoch: connection.epoch, userId: actor.userId });
  });
}

export async function readPublishedSource({ tx, repositoryId, epoch }: DraftScope, path: string) {
  const source = sql<string | null>`(
    select document ->> 'markdown'
    from jsonb_array_elements(${fixtureSnapshot.projection} -> 'documents') as document
    where document ->> 'path' = ${path}
  )`;
  const [row] = await tx.select({ headRevision: fixtureState.headRevision, sourceRevision: fixtureSnapshot.revision, source })
    .from(fixtureState).leftJoin(fixtureSnapshot, and(
      eq(fixtureSnapshot.repositoryId, fixtureState.repositoryId), eq(fixtureSnapshot.revision, fixtureState.indexedRevision),
      eq(fixtureSnapshot.schemaVersion, fixtureState.indexedSchemaVersion), eq(fixtureSnapshot.policyVersion, fixtureState.indexedPolicyVersion),
      eq(fixtureSnapshot.schemaVersion, fixtureSchemaVersion), eq(fixtureSnapshot.policyVersion, fixturePolicyVersion),
      eq(fixtureState.indexedEpoch, epoch),
    )).where(eq(fixtureState.repositoryId, repositoryId));
  return row;
}

export function draftFilter({ repositoryId, epoch, userId }: DraftScope, path: string) {
  return and(eq(markdownDraft.repositoryId, repositoryId), eq(markdownDraft.connectionEpoch, epoch),
    eq(markdownDraft.userId, userId), eq(markdownDraft.path, path));
}

export async function readStoredDraft(scope: DraftScope, path: string) {
  const [stored] = await scope.tx.select().from(markdownDraft).where(draftFilter(scope, path));
  return stored;
}

export function serializeDraft({ path, markdown, sourceRevision, sourceBlob, version, updatedAt }: StoredDraft): FixtureMarkdownDraft {
  return { path, markdown, sourceRevision, sourceBlob, version, updatedAt: updatedAt.toISOString() };
}

function conflict(reason: DraftConflict["reason"], currentRevision: string | null, stored: StoredDraft | undefined): DraftConflict {
  return { status: "conflict", reason, currentRevision, draft: stored ? serializeDraft(stored) : null };
}

export function fixtureDraftSourceBlob(markdown: string) {
  return createHash("sha256").update(markdown, "utf8").digest("hex");
}

export async function readEditableSource(scope: DraftScope, path: string) {
  const published = await readPublishedSource(scope, path);
  const stored = await readStoredDraft(scope, path);
  if ((published?.source ?? null) === null && !stored) return { status: "unavailable" } as const;
  if (!published || published.source === null || published.sourceRevision !== published.headRevision) {
    return conflict("source", published?.headRevision ?? null, stored);
  }

  // Projection documents retain the exact text from the immutable tree at sourceRevision.
  const sourceBlob = fixtureDraftSourceBlob(published.source);
  if (stored && (stored.sourceRevision !== published.sourceRevision || stored.sourceBlob !== sourceBlob)) {
    return conflict("source", published.headRevision, stored);
  }
  return { status: "ready", source: published.source, sourceRevision: published.headRevision, sourceBlob, stored } as const;
}

export async function canEditFixtureMarkdown(headers: Headers, repositoryId: string): Promise<boolean> {
  return (await withDraftAccess(headers, repositoryId, async () => true)) === true;
}

export async function readFixtureDraft(headers: Headers, repositoryId: string, path: string): Promise<ReadDraftResult> {
  if (!isFixtureDraftPath(path)) return { status: "invalid" };
  return withDraftAccess<ReadDraftResult>(headers, repositoryId, async (scope) => {
    const current = await readEditableSource(scope, path);
    if (current.status !== "ready") return current;
    return {
      status: "ready", source: current.source, sourceRevision: current.sourceRevision,
      draft: current.stored ? serializeDraft(current.stored) : null,
    };
  });
}

export async function saveFixtureDraft(headers: Headers, repositoryId: string, input: SaveFixtureDraftInput): Promise<SaveDraftResult> {
  if (!validSave(input)) return { status: "invalid" };
  return withDraftAccess<SaveDraftResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const current = await readEditableSource(scope, input.path);
    if (current.status !== "ready") return current;
    if (current.sourceRevision !== input.sourceRevision) return conflict("source", current.sourceRevision, current.stored);
    if ((current.stored?.version ?? 0) !== input.version) return conflict("version", current.sourceRevision, current.stored);

    const values = { markdown: input.markdown, version: input.version + 1 };
    const [saved] = input.version === 0
      ? await tx.insert(markdownDraft).values({
        repositoryId: scope.repositoryId, userId: scope.userId, connectionEpoch: scope.epoch,
        path: input.path, sourceRevision: current.sourceRevision, sourceBlob: current.sourceBlob, ...values,
      }).onConflictDoNothing().returning()
      : await tx.update(markdownDraft).set({ ...values, updatedAt: sql`clock_timestamp()` }).where(and(
        draftFilter(scope, input.path), eq(markdownDraft.version, input.version),
      )).returning();

    if (saved) return { status: "saved", draft: serializeDraft(saved) };
    return conflict("version", current.sourceRevision, await readStoredDraft(scope, input.path));
  });
}
