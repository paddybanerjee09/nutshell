import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { localSetupConnectionTimeout, requireLocalDatabaseUrl } from "./config.ts";
import { fixtureGrants, fixtureRepositories, personas } from "./local-fixtures.ts";
import { installation, membership, providerGrant, repository, user } from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const setupLock = 1_746_207_811;

export async function migrateAndSeed(databaseUrl: string): Promise<void> {
  const connectionString = requireLocalDatabaseUrl(databaseUrl, "Migration target");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: localSetupConnectionTimeout });
  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock($1::bigint)", [setupLock]);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    await db.transaction(async (tx) => {
      await tx.insert(user).values(Object.values(personas)).onConflictDoNothing();
      await tx.insert(installation).values(fixtureRepositories.map(({ installationId: id }) => ({ id }))).onConflictDoNothing();
      await tx.insert(repository).values(fixtureRepositories).onConflictDoNothing();
      await tx.insert(membership).values(fixtureGrants.map(({ userId, repositoryId }) => ({ userId, repositoryId })))
        .onConflictDoNothing();
      await tx.insert(providerGrant).values(fixtureGrants).onConflictDoNothing();
    });
  } finally {
    await client.end();
  }
}
