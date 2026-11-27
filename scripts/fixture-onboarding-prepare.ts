import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadLocalConfig } from "@nutshell/server/config";
import { closeRuntime, getFixtureDatabase } from "@nutshell/server/runtime";
import type { RepositoryEntity } from "../packages/core/src/repo-snapshot.ts";
import { setVerificationFieldNotesHead } from "./verification-fixture-head.ts";

if (process.env.NUTSHELL_VERIFY !== "1") throw new Error("Onboarding preparation requires the isolated verification database.");
const config = loadLocalConfig();
assert.equal(config.databaseUrl, config.testDatabaseUrl);

const observationEntities: RepositoryEntity[] = [
  {
    schema_version: 1, id: "feat_observation_capture", kind: "feature", title: "Observation capture",
    summary: "Capture and review synthetic field observations.", lifecycle: "active", display_group: "Fieldwork",
    code_paths: ["src/index.ts"], memory_paths: ["nutshell-vault/features/nutshell-setup/CONTEXT.md"],
    relations: [{ type: "depends_on", target: "svc_observation_store" }],
  },
  {
    schema_version: 1, id: "svc_observation_store", kind: "service", title: "Observation store",
    summary: "Store observations for the synthetic project.", lifecycle: "active", display_group: "Fieldwork",
    code_paths: [], memory_paths: [], relations: [],
  },
];

const archivedNote = [
  "---", "id: retired-capture-log", 'date: "2026-11-27"', "status: archived", "tags: [capture]", "---", "",
  "# Retired capture log", "", "## Context", "", "A superseded workflow from the synthetic project.", "",
  "## Decision", "", "Retain the original record for explicit historical retrieval.", "",
  "## Consequences", "", "The record is outside the current memory graph.", "",
  "## Affected files", "", "This archived fixture note.", "",
].join("\n");

try {
  await setVerificationFieldNotesHead(randomBytes(20).toString("hex"), [
    { path: "AGENTS.md", body: "# Field Notes owner instructions\r\n\r\nKeep field observation coordinates in the project records.\r\n" },
    { path: "README.md", body: "# Field Notes\n\nSynthetic repository for the local verification flow.\n" },
    { path: "SPEC.md", body: "# Field Notes scope\n\nRecord synthetic field observations.\n" },
    { path: "src/index.ts", body: 'export const title = "Field Notes";\n' },
    ...observationEntities.map((entity) => ({ path: `.nutshell/entities/${entity.id}.json`, body: JSON.stringify(entity) + "\n" })),
    { path: "nutshell-vault/archive/Retired capture log.md", body: archivedNote },
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
