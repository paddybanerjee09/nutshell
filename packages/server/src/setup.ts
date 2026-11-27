import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { localSetupConnectionTimeout, requireLiveDatabaseUrl, requireLocalDatabaseUrl } from "./config.ts";
import { baselineFixtureHistory } from "./fixture-history-store.ts";
import { lockFixtureConnection } from "./fixture-sync.ts";
import { fixtureGrants, fixtureRepositories, personas } from "./local-fixtures.ts";
import { installation, membership, providerGrant, repository, user } from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const setupLock = 1_746_207_811;

async function migrateSchema(connectionString: string, seed?: (db: NodePgDatabase) => Promise<void>): Promise<void> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: localSetupConnectionTimeout });
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock($1::bigint)", [setupLock]);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    if (seed) await seed(db);
  } finally {
    await client.end();
  }
}

export async function migrateLiveDatabase(databaseUrl: string): Promise<void> {
  await migrateSchema(requireLiveDatabaseUrl(databaseUrl, "Migration target"));
}

export async function migrateAndSeed(databaseUrl: string): Promise<void> {
  await migrateSchema(requireLocalDatabaseUrl(databaseUrl, "Migration target"), async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(user).values(Object.values(personas)).onConflictDoNothing();
      await tx.insert(installation).values(fixtureRepositories.map(({ installationId: id }) => ({ id }))).onConflictDoNothing();
      await tx.insert(repository).values(fixtureRepositories).onConflictDoNothing();
      await tx.insert(membership).values(fixtureGrants.map(({ userId, repositoryId }) => ({ userId, repositoryId })))
        .onConflictDoNothing();
      await tx.insert(providerGrant).values(fixtureGrants).onConflictDoNothing();
      for (const fixture of fixtureRepositories) {
        const connection = await lockFixtureConnection(tx, fixture.id, fixture.installationId);
        if (connection) await baselineFixtureHistory(tx, fixture.id, connection.epoch);
      }
    });
  });
}
