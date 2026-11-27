import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadConfig } from "@nutshell/server/config";
import { setFixtureHead } from "@nutshell/server/fixture-sync";
import { closeRuntime, getFixtureDatabase } from "@nutshell/server/runtime";

if (process.env.NUTSHELL_VERIFY !== "1") throw new Error("Onboarding preparation requires the isolated verification database.");
const config = loadConfig();
assert.equal(config.databaseUrl, config.testDatabaseUrl);

try {
  const repositoryId = 1001;
  await setFixtureHead(repositoryId, randomBytes(20).toString("hex"), [
    { path: "AGENTS.md", body: "# Field Notes owner instructions\r\n\r\nKeep field observation coordinates in the project records.\r\n" },
    { path: "README.md", body: "# Field Notes\n\nSynthetic repository for the local verification flow.\n" },
    { path: "SPEC.md", body: "# Field Notes scope\n\nRecord synthetic field observations.\n" },
    { path: "src/index.ts", body: 'export const title = "Field Notes";\n' },
  ]);

  // Reconnect only this synthetic installation so a repeated run starts a fresh proposal.
  // Preserve the previous immutable revisions, receipts, and simulated proposals.
  const db = getFixtureDatabase();
  await db.transaction(async (tx) => {
    const disconnected = await tx.execute('UPDATE "provider_installation" SET "active" = false WHERE "id" = 2001 AND "active" = true');
    assert.equal(disconnected.rowCount, 1);
    const reconnected = await tx.execute('UPDATE "provider_installation" SET "active" = true WHERE "id" = 2001 AND "active" = false');
    assert.equal(reconnected.rowCount, 1);
  });
} finally {
  await closeRuntime();
}
