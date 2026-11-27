import { createHash } from "node:crypto";
import { canonicalRepositoryChange, projectRepositoryTree, type RepositoryChange, type RepositoryProjection } from "@nutshell/core/snapshot";
import { and, eq } from "drizzle-orm";
import type { FixtureFile } from "./fixture-sync.ts";
import type { FixtureTransaction } from "./runtime.ts";
import { fixtureHistoryEntry, fixtureSnapshot, fixtureState } from "./schema.ts";

export async function readAcceptedFixtureChanges(tx: FixtureTransaction, repositoryId: number) {
  const rows = await tx.select({ id: fixtureHistoryEntry.id, change: fixtureHistoryEntry.payload })
    .from(fixtureHistoryEntry).where(eq(fixtureHistoryEntry.repositoryId, repositoryId));
  return new Map(rows.map(({ id, change }) => [id, change]));
}

export async function projectFixtureHistoryCandidate(tx: FixtureTransaction, repositoryId: number, files: readonly FixtureFile[]) {
  const accepted = await readAcceptedFixtureChanges(tx, repositoryId);
  let hasPublishedBase = accepted.size > 0;
  if (!hasPublishedBase) {
    const [state] = await tx.select({ revision: fixtureState.indexedRevision }).from(fixtureState)
      .where(eq(fixtureState.repositoryId, repositoryId));
    hasPublishedBase = Boolean(state?.revision);
  }
  const tree = new Map(files.map(({ path, body }) => [path, body]));
  const projection = hasPublishedBase ? projectRepositoryTree(tree, { acceptedChanges: accepted }) : projectRepositoryTree(tree);
  return { projection, accepted };
}

export async function recordFixtureHistory(
  tx: FixtureTransaction, repositoryId: number, sourceRevision: string, snapshot: RepositoryProjection,
  accepted: ReadonlyMap<string, RepositoryChange>, observation: "baseline" | "indexed",
) {
  const introduced = snapshot.changes.filter(({ id }) => !accepted.has(id));
  if (!introduced.length) return;

  const entities = new Map(snapshot.entities.map(({ id, title, kind }) => [id, { id, title, kind }]));
  const kindLabels = new Map(snapshot.config.entity_kinds.map(({ slug, label }) => [slug, label]));
  await tx.insert(fixtureHistoryEntry).values(introduced.map((change) => ({
    repositoryId, id: change.id, sourceRevision, payload: change, observation,
    payloadSha256: createHash("sha256").update(canonicalRepositoryChange(change), "utf8").digest("hex"),
    entityLabels: change.entity_ids.flatMap((id) => {
      const entity = entities.get(id);
      return entity ? [{ ...entity, kindLabel: kindLabels.get(entity.kind) ?? entity.kind }] : [];
    }),
  })));
}

// Setup runs under the same active installation, repository and epoch lock as publication.
// Legacy snapshots have one observed indexed revision. Earlier introductions remain unknown.
export async function baselineFixtureHistory(tx: FixtureTransaction, repositoryId: number, epoch: number) {
  const accepted = await readAcceptedFixtureChanges(tx, repositoryId);
  if (accepted.size) return;

  const [indexed] = await tx.select({ revision: fixtureSnapshot.revision, snapshot: fixtureSnapshot.projection })
    .from(fixtureState).innerJoin(fixtureSnapshot, and(
      eq(fixtureSnapshot.repositoryId, fixtureState.repositoryId), eq(fixtureSnapshot.revision, fixtureState.indexedRevision),
      eq(fixtureSnapshot.schemaVersion, fixtureState.indexedSchemaVersion), eq(fixtureSnapshot.policyVersion, fixtureState.indexedPolicyVersion),
    )).where(and(eq(fixtureState.repositoryId, repositoryId), eq(fixtureState.indexedEpoch, epoch)));
  if (!indexed) return;
  await recordFixtureHistory(tx, repositoryId, indexed.revision, indexed.snapshot, accepted, "baseline");
}
