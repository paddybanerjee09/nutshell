import assert from "node:assert/strict";
import { loadLocalConfig } from "@nutshell/server/config";
import { isFixtureRevision } from "@nutshell/server/fixture-sync";
import { closeRuntime } from "@nutshell/server/runtime";
import { sendFixturePush } from "../apps/web/src/app/api/fixture-push.ts";
import { buildFixtureSetupTree } from "../packages/core/src/fixture-setup-tree.ts";
import { setVerificationFieldNotesHead } from "./verification-fixture-head.ts";

try {
  const config = loadLocalConfig();
  assert.equal(process.env.NUTSHELL_VERIFY, "1");
  assert.equal(config.databaseUrl, config.testDatabaseUrl);
  assert.ok(config.webhookSecret, "A signed fixture event requires the local webhook secret.");
  const [revision, deliveryId] = process.argv.slice(2);
  assert.ok(isFixtureRevision(revision) && deliveryId, "Expected a full fixture revision and a delivery ID.");

  const files = buildFixtureSetupTree([{ path: "src/index.ts", body: "export const title = 'Field Notes';\n" }], {
    name: "Field Notes", description: "Verify durable delivery after a stopped worker.", entityId: "ent_field-notes",
  });
  await setVerificationFieldNotesHead(revision, files);
  assert.ok(await sendFixturePush(config.origin, config.webhookSecret, {
    deliveryId, repositoryId: 1001, installationId: 2001, revision,
  }), "The running web process did not accept the signed fixture delivery.");
} finally {
  await closeRuntime();
}
