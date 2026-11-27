import { and, asc, desc, eq, exists, inArray, sql } from "drizzle-orm";
import {
  fixturePolicyVersion, fixtureSchemaVersion, fixtureSnapshotStatus, withFixtureRepositoryAccess, type FixtureSnapshotRead,
} from "./fixture-sync.ts";
import { fixtureDelivery, fixtureHistoryEntry, fixtureState, fixtureTree } from "./schema.ts";

const historyLimit = 100;
const changeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u;
type HistoryRow = typeof fixtureHistoryEntry.$inferSelect;
export type FixtureHistoryEntry = Pick<HistoryRow, "id" | "sourceRevision" | "observation"> & {
  change: HistoryRow["payload"];
  entities: HistoryRow["entityLabels"];
  observedAt: string;
};
export type FixtureProductHistory = {
  status: FixtureSnapshotRead["status"];
  revision: string | null;
  entries: FixtureHistoryEntry[];
  truncated: boolean;
};

function toEntry({ id, payload, sourceRevision, observedAt, entityLabels, observation }: HistoryRow): FixtureHistoryEntry {
  return { id, change: payload, sourceRevision, observedAt: observedAt.toISOString(), entities: entityLabels, observation };
}

export async function readFixtureProductHistory(headers: Headers, repositoryId: string): Promise<FixtureProductHistory | null> {
  return withFixtureRepositoryAccess(headers, repositoryId, async ({ tx, repositoryId: id, epoch }) => {
    const invalidHead = exists(tx.select({ id: fixtureDelivery.id }).from(fixtureDelivery).where(and(
      eq(fixtureDelivery.repositoryId, id), eq(fixtureDelivery.revision, fixtureState.headRevision),
      eq(fixtureDelivery.connectionEpoch, epoch), eq(fixtureDelivery.schemaVersion, fixtureSchemaVersion),
      eq(fixtureDelivery.policyVersion, fixturePolicyVersion), inArray(fixtureDelivery.status, ["invalid", "failed"]),
    )));
    const [state] = await tx.select({
      headRevision: fixtureState.headRevision, indexedRevision: fixtureState.indexedRevision, indexedEpoch: fixtureState.indexedEpoch, invalidHead,
    }).from(fixtureState).where(eq(fixtureState.repositoryId, id));
    const revision = state?.indexedEpoch === epoch ? state.indexedRevision : null;
    const status = fixtureSnapshotStatus(state?.headRevision ?? null, revision, Boolean(state?.invalidHead));
    const entries = await tx.select().from(fixtureHistoryEntry).where(eq(fixtureHistoryEntry.repositoryId, id))
      .orderBy(desc(fixtureHistoryEntry.observedAt), asc(fixtureHistoryEntry.id)).limit(historyLimit + 1);
    return { status, revision, entries: entries.slice(0, historyLimit).map(toEntry), truncated: entries.length > historyLimit };
  });
}

export async function readFixtureHistoryMemory(
  headers: Headers, repositoryId: string, changeId: string, path: string,
): Promise<{ path: string; markdown: string; sourceRevision: string } | null> {
  if (!changeIdPattern.test(changeId) || !path || path.length > 512 || !path.isWellFormed() || path.includes("\0")) return null;
  return withFixtureRepositoryAccess(headers, repositoryId, async ({ tx, repositoryId: id }) => {
    const [event] = await tx.select({ sourceRevision: fixtureHistoryEntry.sourceRevision, change: fixtureHistoryEntry.payload })
      .from(fixtureHistoryEntry).where(and(eq(fixtureHistoryEntry.repositoryId, id), eq(fixtureHistoryEntry.id, changeId)));
    if (!event?.change.memory_paths.includes(path)) return null;

    const markdown = sql<string | null>`(
      select file ->> 'body' from jsonb_array_elements(${fixtureTree.files}) as file
      where file ->> 'path' = ${path}
    )`;
    const [source] = await tx.select({ markdown }).from(fixtureTree)
      .where(and(eq(fixtureTree.repositoryId, id), eq(fixtureTree.revision, event.sourceRevision)));
    return typeof source?.markdown === "string" ? { path, markdown: source.markdown, sourceRevision: event.sourceRevision } : null;
  });
}
