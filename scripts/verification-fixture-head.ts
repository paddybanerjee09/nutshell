import { loadConfig } from "@nutshell/server/config";
import { isFixtureRevision, lockFixtureConnection, normalizeFixtureFiles, storeFixtureTree, writeFixtureHead } from "@nutshell/server/fixture-sync";
import type { FixtureFile } from "@nutshell/server/fixture-sync";
import { getFixtureDatabase } from "@nutshell/server/runtime";

export async function setVerificationFieldNotesHead(revision: string, files: readonly FixtureFile[]) {
  const config = loadConfig();
  if (process.env.NUTSHELL_VERIFY !== "1" || config.databaseUrl !== config.testDatabaseUrl || !isFixtureRevision(revision)) {
    throw new Error("Resetting Field Notes fixtures requires a full revision in the dedicated verification database.");
  }
  const repositoryId = 1001;
  const sorted = normalizeFixtureFiles(files);
  await getFixtureDatabase().transaction(async (tx) => {
    if (!await lockFixtureConnection(tx, repositoryId, 2001)) throw new Error("Verification Field Notes is unavailable.");
    await tx.execute(`DELETE FROM "fixture_history_entry" WHERE "repository_id" = 1001 AND "id" IN (
      'chg_nutshell_setup', 'chg_private_screenshot_fixture', 'chg_observation_history_start', 'chg_observation_history_correct',
      'chg_observation_history_reverse', 'chg_field-notes'
    )`);
    await tx.execute(`UPDATE "fixture_state" SET "indexed_revision" = NULL, "indexed_epoch" = NULL,
      "indexed_schema_version" = NULL, "indexed_policy_version" = NULL WHERE "repository_id" = 1001`);
    await storeFixtureTree(tx, repositoryId, revision, sorted);
    await writeFixtureHead(tx, repositoryId, revision);
  });
}
