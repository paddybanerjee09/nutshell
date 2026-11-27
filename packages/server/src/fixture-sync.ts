import { projectRepositoryTree, type RepositoryProjection } from "@nutshell/core/snapshot";
import { and, eq, exists, inArray, lte, sql } from "drizzle-orm";
import { fixtureRepositories } from "./local-fixtures.ts";
import { getFixtureDatabase, lockRepositoryGrant, resolveRepositoryActor, resolveRepositoryReadFilter, type FixtureTransaction } from "./runtime.ts";
import { fixtureDelivery, fixtureDraftProposal, fixtureSetupProposal, fixtureSnapshot, fixtureState, fixtureTree, installation, repository } from "./schema.ts";

export const fixtureSchemaVersion = 1;
export const fixturePolicyVersion = 1;
const schemaVersion = fixtureSchemaVersion;
const policyVersion = fixturePolicyVersion;
const maxAttempts = 5;
const revisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const deliveryPattern = /^[A-Za-z0-9_.-]{1,128}$/u;

export function isFixtureRevision(revision: unknown): revision is string {
  return typeof revision === "string" && revisionPattern.test(revision);
}

export type FixtureFile = { path: string; body: string };
type FixtureDelivery = typeof fixtureDelivery.$inferSelect;
export type DeliveryInput = { deliveryId: string; repositoryId: number; installationId: number; revision: string };

export type FixtureSnapshotRead = {
  status: "pending" | "current" | "stale" | "invalid";
  headRevision: string | null;
  revision: string | null;
  snapshot: RepositoryProjection | null;
};

export async function lockFixtureConnection(tx: FixtureTransaction, repositoryId: number, installationId: number, lock: "share" | "update" = "update") {
  const isFixture = fixtureRepositories.some((item) => item.id === repositoryId && item.installationId === installationId);
  if (!isFixture) return null;

  // Installation invalidation takes this lock before bumping each associated repository's epoch.
  const [activeInstallation] = await tx.select({ id: installation.id }).from(installation)
    .where(and(eq(installation.id, installationId), eq(installation.active, true))).for("share");
  if (!activeInstallation) return null;

  const [connection] = await tx.select({ epoch: repository.connectionEpoch }).from(repository)
    .where(and(eq(repository.id, repositoryId), eq(repository.active, true), eq(repository.installationId, installationId)))
    .for(lock);
  return connection ?? null;
}

export type FixtureRepositoryScope = {
  tx: FixtureTransaction; repositoryId: number; installationId: number; epoch: number;
  userId: string; canWrite: boolean; canConfigure: boolean;
};

export async function withFixtureRepositoryAccess<Result>(
  headers: Headers, repositoryId: string, perform: (scope: FixtureRepositoryScope) => Promise<Result>,
): Promise<Result | null> {
  const fixture = fixtureRepositories.find(({ id }) => String(id) === repositoryId);
  if (!fixture) return null;
  const actor = await resolveRepositoryActor(headers);
  if (!actor) return null;

  return getFixtureDatabase().transaction(async (tx) => {
    const connection = await lockFixtureConnection(tx, fixture.id, fixture.installationId, "share");
    if (!connection) return null;
    const grant = await lockRepositoryGrant(tx, actor, fixture.id);
    if (!grant) return null;
    return perform({ tx, repositoryId: fixture.id, installationId: fixture.installationId,
      epoch: connection.epoch, userId: actor.userId, ...grant });
  });
}

export async function acceptFixtureDelivery(input: DeliveryInput): Promise<"accepted" | "duplicate" | "unavailable"> {
  const { deliveryId, repositoryId, installationId, revision } = input;
  if (!deliveryPattern.test(deliveryId) || !isFixtureRevision(revision)) return "unavailable";

  return getFixtureDatabase().transaction(async (tx) => {
    const [previous] = await tx.select({ id: fixtureDelivery.id }).from(fixtureDelivery).where(eq(fixtureDelivery.id, deliveryId));
    if (previous) return "duplicate";

    const connection = await lockFixtureConnection(tx, repositoryId, installationId);
    if (!connection) return "unavailable";

    // A delayed proposal event stays scoped to the connection that merged its exact revision.
    const proposals = await tx.select({
      repositoryId: fixtureSetupProposal.repositoryId,
      epoch: fixtureSetupProposal.connectionEpoch,
      mergedRevision: fixtureSetupProposal.mergedRevision,
    }).from(fixtureSetupProposal).where(eq(fixtureSetupProposal.deliveryId, deliveryId)).unionAll(tx.select({
      repositoryId: fixtureDraftProposal.repositoryId,
      epoch: fixtureDraftProposal.connectionEpoch,
      mergedRevision: fixtureDraftProposal.mergedRevision,
    }).from(fixtureDraftProposal).where(eq(fixtureDraftProposal.deliveryId, deliveryId)));
    if (proposals.some((proposal) => proposal.repositoryId !== repositoryId || proposal.epoch !== connection.epoch || proposal.mergedRevision !== revision)) {
      return "unavailable";
    }

    // The receipt and the work lease share one committed row.
    const [stored] = await tx.insert(fixtureDelivery).values({
      id: deliveryId, repositoryId, installationId, revision, connectionEpoch: connection.epoch, schemaVersion, policyVersion,
    }).onConflictDoNothing().returning({ id: fixtureDelivery.id });
    return stored ? "accepted" : "duplicate";
  });
}

export function normalizeFixtureFiles(files: readonly FixtureFile[]) {
  if (files.length > 5_000) throw new Error("The fixture tree exceeds the path limit.");

  const paths = new Set<string>();
  let treeBytes = 0;
  for (const { path, body } of files) {
    if (paths.has(path)) throw new Error("The fixture tree contains a duplicate path.");
    if (path.length > 512 || body.length > 256 * 1024 || path.includes("\0") || body.includes("\0")) {
      throw new Error("A fixture tree entry exceeds the text limits.");
    }
    paths.add(path);
    treeBytes += Buffer.byteLength(path) + Buffer.byteLength(body);
  }
  if (treeBytes > 8 * 1024 * 1024) throw new Error("The fixture tree exceeds the total byte limit.");

  return [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export async function readFixtureTree(tx: FixtureTransaction, repositoryId: number, revision: string) {
  const [tree] = await tx.select({ files: fixtureTree.files }).from(fixtureTree)
    .where(and(eq(fixtureTree.repositoryId, repositoryId), eq(fixtureTree.revision, revision)));
  return tree?.files;
}

export async function storeFixtureTree(tx: FixtureTransaction, repositoryId: number, revision: string, files: FixtureFile[]) {
  const [stored] = await tx.insert(fixtureTree).values({ repositoryId, revision, files })
    .onConflictDoNothing().returning({ revision: fixtureTree.revision });
  if (!stored) {
    const existing = await readFixtureTree(tx, repositoryId, revision);
    if (existing?.length !== files.length || !existing.every(({ path, body }, index) =>
      path === files[index]?.path && body === files[index]?.body)) {
      throw new Error("This fixture revision already identifies a different immutable tree.");
    }
  }
}

export async function writeFixtureHead(tx: FixtureTransaction, repositoryId: number, revision: string) {
  await tx.insert(fixtureState).values({ repositoryId, headRevision: revision })
    .onConflictDoUpdate({ target: fixtureState.repositoryId, set: { headRevision: revision } });
}

export async function setFixtureHead(repositoryId: number, revision: string, files: readonly FixtureFile[]): Promise<void> {
  const fixture = fixtureRepositories.find((item) => item.id === repositoryId);
  if (!fixture || !isFixtureRevision(revision)) throw new Error("Expected a fixture repository and a full lowercase commit SHA.");
  const sortedFiles = normalizeFixtureFiles(files);
  await getFixtureDatabase().transaction(async (tx) => {
    if (!await lockFixtureConnection(tx, repositoryId, fixture.installationId)) throw new Error("The fixture repository is unavailable.");
    await storeFixtureTree(tx, repositoryId, revision, sortedFiles);
    await writeFixtureHead(tx, repositoryId, revision);
  });
}

async function publishFixtureDelivery(tx: FixtureTransaction, job: FixtureDelivery) {
  const { repositoryId, installationId, revision, connectionEpoch } = job;
  const connection = await lockFixtureConnection(tx, repositoryId, installationId);
  if (connection?.epoch !== connectionEpoch || job.schemaVersion !== schemaVersion || job.policyVersion !== policyVersion) {
    return { status: "obsolete", failureCode: null } as const;
  }

  const [state] = await tx.select({ headRevision: fixtureState.headRevision }).from(fixtureState)
    .where(eq(fixtureState.repositoryId, repositoryId));
  if (state?.headRevision !== revision) return { status: "obsolete", failureCode: null } as const;

  const tree = await readFixtureTree(tx, repositoryId, revision);
  if (!tree) return { status: "invalid", failureCode: "missing_tree" } as const;

  const projected = projectRepositoryTree(new Map(tree.map(({ path, body }) => [path, body])));
  if (!projected.ok) return { status: "invalid", failureCode: "invalid_tree" } as const;

  await tx.insert(fixtureSnapshot).values({ repositoryId, revision, schemaVersion, policyVersion, projection: projected.snapshot })
    .onConflictDoNothing();
  await tx.update(fixtureState).set({
    indexedRevision: revision, indexedEpoch: connectionEpoch, indexedSchemaVersion: schemaVersion, indexedPolicyVersion: policyVersion,
  }).where(eq(fixtureState.repositoryId, repositoryId));
  return { status: "published", failureCode: null } as const;
}

export async function processNextFixtureDelivery(): Promise<boolean> {
  return getFixtureDatabase().transaction(async (tx) => {
    const [job] = await tx.select().from(fixtureDelivery)
      .where(and(eq(fixtureDelivery.status, "queued"), lte(fixtureDelivery.availableAt, sql`now()`)))
      .orderBy(fixtureDelivery.receivedAt, fixtureDelivery.id).limit(1).for("update", { skipLocked: true });
    if (!job) return false;

    const attempts = job.attempts + 1;
    try {
      await tx.transaction(async (work) => {
        const result = await publishFixtureDelivery(work, job);
        await work.update(fixtureDelivery).set({ ...result, attempts, processedAt: sql`now()` }).where(eq(fixtureDelivery.id, job.id));
      });
    } catch {
      // Rolling back the savepoint leaves receipt progress writable without publishing a partial snapshot.
      const retry = attempts < maxAttempts;
      await tx.update(fixtureDelivery).set({
        status: retry ? "queued" : "failed", failureCode: "projection_error", attempts,
        availableAt: sql`now() + (${2 ** attempts} * interval '1 second')`, processedAt: retry ? null : sql`now()`,
      }).where(eq(fixtureDelivery.id, job.id));
    }
    return true;
  });
}

export async function readFixtureSnapshot(headers: Headers, repositoryId: string): Promise<FixtureSnapshotRead | null> {
  const fixture = fixtureRepositories.find((item) => String(item.id) === repositoryId);
  if (!fixture) return null;
  const filter = await resolveRepositoryReadFilter(headers, repositoryId);
  if (!filter) return null;

  const db = getFixtureDatabase();
  const invalidHead = exists(db.select({ id: fixtureDelivery.id }).from(fixtureDelivery).where(and(
    eq(fixtureDelivery.repositoryId, repository.id), eq(fixtureDelivery.revision, fixtureState.headRevision),
    eq(fixtureDelivery.connectionEpoch, repository.connectionEpoch), eq(fixtureDelivery.schemaVersion, schemaVersion),
    eq(fixtureDelivery.policyVersion, policyVersion), inArray(fixtureDelivery.status, ["invalid", "failed"]),
  )));
  const [row] = await db.select({
    headRevision: fixtureState.headRevision, revision: fixtureSnapshot.revision, snapshot: fixtureSnapshot.projection,
    invalidHead,
  }).from(repository).leftJoin(fixtureState, eq(fixtureState.repositoryId, repository.id))
    .leftJoin(fixtureSnapshot, and(
      eq(fixtureSnapshot.repositoryId, repository.id), eq(fixtureSnapshot.revision, fixtureState.indexedRevision),
      eq(fixtureSnapshot.schemaVersion, fixtureState.indexedSchemaVersion), eq(fixtureSnapshot.policyVersion, fixtureState.indexedPolicyVersion),
      eq(fixtureState.indexedEpoch, repository.connectionEpoch),
    )).where(and(filter, eq(repository.installationId, fixture.installationId)));
  if (!row) return null;

  const { headRevision, revision, snapshot } = row;
  const status = revision && revision === headRevision ? "current" : row.invalidHead ? "invalid" : revision ? "stale" : "pending";
  return { status, headRevision, revision, snapshot };
}
