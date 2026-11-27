import { createHash } from "node:crypto";
import { isLiteralPath, isNewVaultNotePath } from "@nutshell/core/vault";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { fixturePolicyVersion, fixtureSchemaVersion, isFixtureRevision, lockFixtureConnection, readFixtureTree, type FixtureFile } from "./fixture-sync.ts";
import { fixtureRepositories } from "./local-fixtures.ts";
import { getFixtureDatabase, lockRepositoryGrant, resolveRepositoryActor, type FixtureTransaction } from "./runtime.ts";
import { fixtureSnapshot, fixtureState, markdownDraft } from "./schema.ts";

export const maxFixtureDraftBytes = 256 * 1024;
export const maxFixtureDraftPathBytes = 512;
export const maxFixtureDraftTitleLength = 160;
const maxExpectedVersion = 2_147_483_646;
const maxNewDrafts = 5_000;

export type FixtureMarkdownDraft = {
  path: string;
  markdown: string;
  sourceRevision: string;
  sourceBlob: string | null;
  version: number;
  updatedAt: string;
};

export type SaveFixtureDraftInput = Pick<FixtureMarkdownDraft, "path" | "markdown" | "sourceRevision" | "version">;
export type CreateFixtureDraftInput = Pick<FixtureMarkdownDraft, "path" | "sourceRevision"> & { title: string };

type AccessRejection = { status: "unavailable" | "forbidden" };
type DraftRejection = AccessRejection | { status: "invalid" };
type DraftConflict = { status: "conflict"; reason: "source" | "version"; currentRevision: string | null; draft: FixtureMarkdownDraft | null };
type ReadDraftResult = { status: "ready"; source: string; sourceRevision: string; draft: FixtureMarkdownDraft | null } | DraftConflict | DraftRejection;
type SaveDraftResult = { status: "saved"; draft: FixtureMarkdownDraft } | DraftConflict | DraftRejection;
type ListDraftsResult = { status: "ready"; drafts: { path: string }[] } | AccessRejection;

export type DraftScope = { tx: FixtureTransaction; repositoryId: number; installationId: number; epoch: number; userId: string };
type StoredDraft = typeof markdownDraft.$inferSelect;

export function isFixtureDraftPath(path: string) {
  if (typeof path !== "string" || path.length > maxFixtureDraftPathBytes || !path.isWellFormed() ||
      Buffer.byteLength(path) > maxFixtureDraftPathBytes) return false;
  return path.startsWith("nutshell-vault/") && !path.startsWith("nutshell-vault/archive/") && /\.md$/iu.test(path) &&
    isLiteralPath(path) && path.split("/").every((segment) => segment.toLowerCase() !== ".git");
}

export function isFixtureDraftTargetAbsent(files: readonly FixtureFile[], path: string) {
  const target = path.toLowerCase();
  return !files.some((file) => {
    const existing = file.path.toLowerCase();
    return existing === target || existing.startsWith(target + "/") || target.startsWith(existing + "/");
  });
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

function draftAuthorFilter({ repositoryId, epoch, userId }: DraftScope) {
  return and(eq(markdownDraft.repositoryId, repositoryId), eq(markdownDraft.connectionEpoch, epoch),
    eq(markdownDraft.userId, userId));
}

export function draftFilter(scope: DraftScope, path: string) {
  return and(draftAuthorFilter(scope), eq(markdownDraft.path, path));
}

function newDraftFilter(scope: DraftScope) {
  return and(draftAuthorFilter(scope), isNull(markdownDraft.sourceBlob));
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
  if (!published || published.sourceRevision !== published.headRevision) {
    return conflict("source", published?.headRevision ?? null, stored);
  }

  // The projection retains exact source bytes. A null digest is the base of an explicitly created draft.
  const sourceBlob = published.source === null ? null : fixtureDraftSourceBlob(published.source);
  if (stored && (stored.sourceRevision !== published.sourceRevision || stored.sourceBlob !== sourceBlob)) {
    return conflict("source", published.headRevision, stored);
  }
  return { status: "ready", source: published.source ?? "", sourceRevision: published.headRevision, sourceBlob, stored } as const;
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

export async function listFixtureNewDrafts(headers: Headers, repositoryId: string): Promise<ListDraftsResult> {
  return withDraftAccess<ListDraftsResult>(headers, repositoryId, async (scope) => ({
    status: "ready",
    drafts: await scope.tx.select({ path: markdownDraft.path }).from(markdownDraft)
      .where(newDraftFilter(scope)).orderBy(markdownDraft.path).limit(maxNewDrafts),
  }));
}

function starterMarkdown(path: string, title: string) {
  return [
    "---", `id: note-${fixtureDraftSourceBlob(path)}`, `date: ${new Date().toISOString().slice(0, 10)}`,
    "status: active", "tags: [note]", "---", "", `# ${title}`, "",
    "## Context", "", "## Decision", "", "## Consequences", "", "## Affected files", "",
  ].join("\n");
}

export async function createFixtureDraft(headers: Headers, repositoryId: string, input: CreateFixtureDraftInput): Promise<SaveDraftResult> {
  if (!isFixtureDraftPath(input.path) || !isNewVaultNotePath(input.path) || !isFixtureRevision(input.sourceRevision) ||
      typeof input.title !== "string" || !input.title.trim() || input.title.length > maxFixtureDraftTitleLength ||
      !input.title.isWellFormed() || /[\p{Cc}\u2028\u2029]/u.test(input.title)) return { status: "invalid" };

  return withDraftAccess<SaveDraftResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const published = await readPublishedSource(scope, input.path);
    const stored = await readStoredDraft(scope, input.path);
    if (!published || published.source !== null || published.headRevision !== input.sourceRevision ||
        published.sourceRevision !== input.sourceRevision) return conflict("source", published?.headRevision ?? null, stored);
    if (stored) return conflict(stored.sourceRevision === input.sourceRevision && stored.sourceBlob === null ? "version" : "source",
      input.sourceRevision, stored);

    const files = await readFixtureTree(tx, scope.repositoryId, input.sourceRevision);
    if (!files || !isFixtureDraftTargetAbsent(files, input.path)) return conflict("source", input.sourceRevision, undefined);
    const [limit] = await tx.select({ total: count() }).from(markdownDraft).where(newDraftFilter(scope));
    if (!limit || limit.total >= maxNewDrafts) return { status: "invalid" };

    const [saved] = await tx.insert(markdownDraft).values({
      repositoryId: scope.repositoryId, userId: scope.userId, connectionEpoch: scope.epoch,
      path: input.path, sourceRevision: input.sourceRevision, sourceBlob: null,
      markdown: starterMarkdown(input.path, input.title.trim()), version: 1,
    }).onConflictDoNothing().returning();
    if (saved) return { status: "saved", draft: serializeDraft(saved) };
    return conflict("version", input.sourceRevision, await readStoredDraft(scope, input.path));
  }, "update");
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
