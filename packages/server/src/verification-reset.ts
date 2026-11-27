import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { localSetupConnectionTimeout, requireLocalDatabaseUrl } from "./config.ts";
import { fixtureGrants, fixtureRepositories, personas } from "./local-fixtures.ts";
import {
  account, fixtureDelivery, fixtureDraftProposal, fixtureHistoryEntry, fixtureSetupProposal, fixtureState, fixtureTree,
  githubRepositoryAssociation, installation, markdownDraft, membership, providerGrant, repository, session, teamNote, teamTask, user,
} from "./schema.ts";

const verificationDatabase = "nutshell_alpha_test";
const verificationLock = 1_746_207_812;

export async function withVerificationLock<T>(databaseUrl: string, operation: (client: pg.Client) => Promise<T>): Promise<T> {
  const connectionString = requireLocalDatabaseUrl(databaseUrl, "Verification target", verificationDatabase);
  const client = new pg.Client({
    connectionString, connectionTimeoutMillis: localSetupConnectionTimeout,
    statement_timeout: 30_000, query_timeout: 35_000, options: "-c search_path=pg_catalog,public -c idle_session_timeout=0",
  });
  try {
    await client.connect();
    const { rows: [target] } = await client.query<{ database: string; loopback: boolean | null }>(`
      SELECT pg_catalog.current_database() AS database,
        pg_catalog.inet_server_addr() IN ('127.0.0.1'::inet, '::1'::inet) AS loopback
    `);
    if (target?.database !== verificationDatabase || target.loopback !== true) {
      throw new Error("The connected PostgreSQL server is not the dedicated loopback verification database.");
    }
    const { rows: [lease] } = await client.query<{ locked: boolean }>(
      "SELECT pg_catalog.pg_try_advisory_lock($1::bigint) AS locked", [verificationLock],
    );
    if (lease?.locked !== true) throw new Error("Another Nutshell verification operation is using the test database.");
    return await operation(client);
  } finally {
    // Ending this connection releases its advisory lock even when an operation fails.
    await client.end();
  }
}

export async function resetVerificationFixtures(databaseUrl: string): Promise<void> {
  await withVerificationLock(databaseUrl, (client) => drizzle(client).transaction(async (tx) => {
    const repositoryIds = fixtureRepositories.map(({ id }) => id);
    const installationIds = fixtureRepositories.map(({ installationId }) => installationId);
    const fixtureUsers = Object.values(personas);
    const userIds = fixtureUsers.map(({ id }) => id);
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

    // Publication locks the installation before its repository. Validate the reserved IDs under the same lock order.
    const installations = await tx.select({ id: installation.id }).from(installation)
      .where(inArray(installation.id, installationIds)).orderBy(installation.id).for("update");
    const repositories = await tx.select({
      id: repository.id, installationId: repository.installationId, name: repository.name, description: repository.description,
    }).from(repository).where(or(inArray(repository.id, repositoryIds), inArray(repository.installationId, installationIds)))
      .orderBy(repository.id).for("update");
    const users = await tx.select({ id: user.id, email: user.email }).from(user)
      .where(inArray(user.id, userIds)).orderBy(user.id).for("update");
    if (installations.length !== installationIds.length || repositories.length !== repositoryIds.length ||
        !fixtureRepositories.every((fixture) => repositories.some((row) => row.id === fixture.id &&
          row.installationId === fixture.installationId && row.name === fixture.name && row.description === fixture.description)) ||
        !fixtureUsers.every((fixture) => users.some((row) => row.id === fixture.id && row.email === fixture.email))) {
      throw new Error("The verification database lacks the original fixture identities or shares a reserved installation. Check the target and run local setup if it is unseeded.");
    }

    const liveRepository = await tx.select({ id: githubRepositoryAssociation.repositoryId }).from(githubRepositoryAssociation)
      .where(inArray(githubRepositoryAssociation.repositoryId, repositoryIds)).limit(1);
    const linkedAccount = await tx.select({ id: account.id }).from(account).where(inArray(account.userId, userIds)).limit(1);
    const unrelatedDraft = await tx.select({ userId: markdownDraft.userId }).from(markdownDraft)
      .where(and(inArray(markdownDraft.repositoryId, repositoryIds), notInArray(markdownDraft.userId, userIds))).limit(1);
    const unrelatedProposal = await tx.select({ id: fixtureDraftProposal.id }).from(fixtureDraftProposal)
      .where(and(inArray(fixtureDraftProposal.repositoryId, repositoryIds), notInArray(fixtureDraftProposal.userId, userIds))).limit(1);
    if (liveRepository.length || linkedAccount.length || unrelatedDraft.length || unrelatedProposal.length) {
      throw new Error("Fixture reset would overlap a linked repository, account, or unrelated draft or proposal.");
    }

    await tx.delete(session).where(inArray(session.userId, userIds));
    await tx.delete(teamTask).where(and(inArray(teamTask.repositoryId, repositoryIds),
      inArray(teamTask.creatorId, userIds), inArray(teamTask.assigneeId, userIds)));
    await tx.delete(teamNote).where(and(inArray(teamNote.repositoryId, repositoryIds), inArray(teamNote.creatorId, userIds)));
    await tx.delete(markdownDraft).where(and(inArray(markdownDraft.repositoryId, repositoryIds), inArray(markdownDraft.userId, userIds)));
    await tx.delete(fixtureDraftProposal).where(and(inArray(fixtureDraftProposal.repositoryId, repositoryIds),
      inArray(fixtureDraftProposal.userId, userIds)));
    await tx.delete(fixtureSetupProposal).where(and(inArray(fixtureSetupProposal.repositoryId, repositoryIds),
      eq(fixtureSetupProposal.provider, "fixture")));
    await tx.delete(fixtureDelivery).where(or(...fixtureRepositories.map(({ id, installationId }) =>
      and(eq(fixtureDelivery.repositoryId, id), eq(fixtureDelivery.installationId, installationId)))));
    await tx.delete(fixtureState).where(inArray(fixtureState.repositoryId, repositoryIds));
    await tx.delete(fixtureHistoryEntry).where(inArray(fixtureHistoryEntry.repositoryId, repositoryIds));
    // Fixture snapshots reference their same-repository source trees with ON DELETE CASCADE.
    await tx.delete(fixtureTree).where(inArray(fixtureTree.repositoryId, repositoryIds));

    await tx.update(installation).set({ active: true }).where(inArray(installation.id, installationIds));
    await tx.update(repository).set({ active: true, connectionEpoch: sql`${repository.connectionEpoch} + 1` })
      .where(inArray(repository.id, repositoryIds));
    await tx.delete(providerGrant).where(and(inArray(providerGrant.repositoryId, repositoryIds), inArray(providerGrant.userId, userIds)));
    await tx.delete(membership).where(and(inArray(membership.repositoryId, repositoryIds), inArray(membership.userId, userIds)));
    await tx.insert(membership).values(fixtureGrants.map(({ userId, repositoryId }) => ({ userId, repositoryId })));
    await tx.insert(providerGrant).values(fixtureGrants);
  }));
}
