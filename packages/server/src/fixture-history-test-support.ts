import type pg from "pg";
import { loadConfig } from "./config.ts";
import { normalizeFixtureFiles, type FixtureFile } from "./fixture-sync.ts";

export async function preserveFixtureTestHistory(db: pg.Pool, repositoryId: number, files: readonly FixtureFile[]): Promise<FixtureFile[]> {
  const { rows } = await db.query<{ id: string; payload: unknown }>(
    "SELECT id, payload FROM fixture_history_entry WHERE repository_id = $1", [repositoryId]);
  const byPath = new Map(files.map((file) => [file.path, file]));
  byPath.delete(".nutshell/changes/chg_nutshell_setup.json");
  for (const { id, payload } of rows) {
    const path = ".nutshell/changes/" + id + ".json";
    byPath.set(path, { path, body: JSON.stringify(payload) });
  }
  return normalizeFixtureFiles([...byPath.values()]);
}

export async function isolateFixtureOnboardingHistory(db: pg.Pool, repositoryId: 1001 | 1002): Promise<() => Promise<void>> {
  const config = loadConfig();
  if (process.env.NUTSHELL_VERIFY !== "1" || config.databaseUrl !== config.testDatabaseUrl) {
    throw new Error("Fixture history isolation requires the dedicated verification database.");
  }

  async function inTestTransaction<Result>(work: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
    const client = await db.connect();
    try {
      const { rows } = await client.query<{ name: string }>("SELECT current_database() AS name");
      if (rows[0]?.name !== "nutshell_alpha_test") throw new Error("Fixture history isolation reached an unexpected database.");
      await client.query("BEGIN");
      await client.query("SELECT id FROM repository WHERE id = $1 FOR UPDATE", [repositoryId]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } finally {
      client.release(true);
    }
  }

  const prior = await inTestTransaction(async (client) => {
    const { rows: states } = await client.query<{ value: unknown }>(
      "SELECT to_jsonb(fixture_state) AS value FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    const { rows: entries } = await client.query<{ value: unknown }>(
      "WITH saved AS (DELETE FROM fixture_history_entry WHERE repository_id = $1 RETURNING *) SELECT to_jsonb(saved) AS value FROM saved", [repositoryId]);
    await client.query(
      "UPDATE fixture_state SET indexed_revision = NULL, indexed_epoch = NULL, indexed_schema_version = NULL, indexed_policy_version = NULL WHERE repository_id = $1",
      [repositoryId]);
    return { state: states[0]?.value, entries: entries.map(({ value }) => value) };
  });
  return async () => inTestTransaction(async (client) => {
    await client.query("DELETE FROM fixture_history_entry WHERE repository_id = $1", [repositoryId]);
    await client.query("INSERT INTO fixture_history_entry SELECT * FROM jsonb_populate_recordset(NULL::fixture_history_entry, $1::jsonb)",
      [JSON.stringify(prior.entries)]);
    await client.query("DELETE FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    if (prior.state) {
      await client.query("INSERT INTO fixture_state SELECT * FROM jsonb_populate_record(NULL::fixture_state, $1::jsonb)", [JSON.stringify(prior.state)]);
    }
  });
}
