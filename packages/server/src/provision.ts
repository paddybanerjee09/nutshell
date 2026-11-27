import pg from "pg";
import { requireLocalDatabaseUrl } from "./config.ts";

export async function ensureLocalDatabase(connectionString: string): Promise<void> {
  const connection = new URL(requireLocalDatabaseUrl(connectionString, "Provisioning target"));
  const target = new pg.Client({ connectionString: connection.href, connectionTimeoutMillis: 5_000 });
  try {
    await target.connect();
    return;
  } catch (error) {
    if (!(error instanceof pg.DatabaseError) || error.code !== "3D000") throw error;
  } finally {
    await target.end();
  }

  const name = connection.pathname.slice(1);
  connection.pathname = "/postgres";
  const client = new pg.Client({ connectionString: connection.href, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (found.rowCount) return;
    try {
      await client.query("CREATE DATABASE " + name);
    } catch (error) {
      if (!(error instanceof pg.DatabaseError) || error.code !== "42P04") throw error;
    }
  } finally {
    await client.end();
  }
}
