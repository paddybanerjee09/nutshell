import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadLocalConfig } from "@nutshell/server/config";
import { isFixtureRevision, readFixtureTree, setFixtureHead } from "@nutshell/server/fixture-sync";
import { closeRuntime, getFixtureDatabase } from "@nutshell/server/runtime";
import { sendFixturePush } from "../apps/web/src/app/api/fixture-push.ts";
import type { RepositoryChange, RepositoryEntity } from "../packages/core/src/repo-snapshot.ts";

const repositoryId = 1001;
const entityId = "feat_observation_capture";
const entityPath = ".nutshell/entities/" + entityId + ".json";
const notePath = "nutshell-vault/features/history-observation/CONTEXT.md";
const archivePath = "nutshell-vault/archive/History observation.md";
const indexPath = "nutshell-vault/_INDEX.md";
const row = "| [" + notePath + "](features/history-observation/CONTEXT.md) | Original observation history note. | active | history |";
const originalText = "The original observation workflow recorded location and field conditions.";
const originalNote = [
  "---", "id: history-observation-note", 'date: "2026-11-27"', "status: active", "tags: [history]", "---", "",
  "# Observation workflow", "", "## Context", "", originalText, "",
  "## Decision", "", "Keep an original revision reference for every accepted semantic event.", "",
  "## Consequences", "", "Later repository context may move this note.", "",
  "## Affected files", "", "src/index.ts", "",
].join("\n");
const initialChange: RepositoryChange = {
  schema_version: 1, id: "chg_observation_history_start", entity_ids: [entityId],
  change_type: "added", summary: "Start observation history", product_impact: "user_visible",
  rationale: "Explain the original workflow to field readers.", technical_summary: "Associate a stable feature and memory path.",
  memory_paths: [notePath], evidence: [],
};
const correction: RepositoryChange = {
  ...initialChange, id: "chg_observation_history_correct", change_type: "corrected",
  summary: "Clarify the observation workflow", memory_paths: [], corrects_change_id: initialChange.id,
};
const reversal: RepositoryChange = {
  ...initialChange, id: "chg_observation_history_reverse", change_type: "reverted",
  summary: "Retire the observation workflow", memory_paths: [], reverses_change_id: correction.id,
};
const changePath = (id: string) => ".nutshell/changes/" + id + ".json";
const record = (value: RepositoryChange | RepositoryEntity) => JSON.stringify(value) + "\n";

let phase = "preflight";

async function verifyProductHistory() {
  assert.equal(process.env.NUTSHELL_VERIFY, "1");
  const config = loadLocalConfig();
  assert.equal(config.databaseUrl, config.testDatabaseUrl);
  const secret = config.webhookSecret;
  assert.ok(secret, "The fixture webhook secret is required.");
  const sourceRevision = process.argv[2];
  assert.ok(isFixtureRevision(sourceRevision), "Expected the exact previously indexed fixture revision.");

  const session = await fetch(config.origin + "/api/auth/nutshell/persona", {
    method: "POST", headers: { origin: config.origin, "content-type": "application/json" },
    body: JSON.stringify({ persona: "coordinator" }), redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  assert.equal(session.status, 200);
  const cookies = session.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookies);
  const base = await getFixtureDatabase().transaction((tx) => readFixtureTree(tx, repositoryId, sourceRevision));
  assert.ok(base?.length, "Expected the retained fixture tree.");
  const tree = new Map(base.map(({ path, body }) => [path, body]));
  const index = tree.get(indexPath);
  const entity = tree.get(entityPath);
  assert.ok(index && index.includes("\n\n## Consequences"), "Expected the fixture index source.");
  assert.ok(entity, "Expected the fixture entity source.");
  const originalEntity = JSON.parse(entity) as RepositoryEntity;

  async function publish(stage: string, candidate: ReadonlyMap<string, string>, retained?: string) {
    phase = stage;
    const revision = randomBytes(20).toString("hex");
    const deliveryId = randomUUID();
    await setFixtureHead(repositoryId, revision, [...candidate].map(([path, body]) => ({ path, body })));
    assert.ok(await sendFixturePush(config.origin, secret!, { repositoryId, installationId: 2001, revision, deliveryId }));
    const until = Date.now() + 50_000;
    while (Date.now() < until) {
      const response = await fetch(config.origin + "/api/repos/1001/snapshot", {
        headers: { cookie: cookies }, redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      const snapshot = await response.json() as { headRevision: string; revision: string; status: string };
      if (snapshot.headRevision === revision && snapshot.status === (retained ? "invalid" : "current")) {
        assert.equal(snapshot.revision, retained ?? revision);
        const { rows: [delivery] } = await getFixtureDatabase().execute<{ status: string; failureCode: string | null }>(
          `SELECT "status", "failure_code" AS "failureCode" FROM "fixture_delivery" WHERE "id" = '${deliveryId}'`,
        );
        assert.deepEqual(delivery, retained ? { status: "invalid", failureCode: "invalid_history" } : { status: "published", failureCode: null });
        return revision;
      }
      if (!retained && snapshot.headRevision === revision && snapshot.status === "invalid") {
        throw new Error("The valid fixture history did not publish.");
      }
      await delay(250);
    }
    throw new Error("The fixture history revision did not settle.");
  }

  tree.set(indexPath, index.replace("\n\n## Consequences", "\n" + row + "\n\n## Consequences"));
  tree.set(notePath, originalNote);
  tree.set(entityPath, record({ ...originalEntity, memory_paths: [...originalEntity.memory_paths, notePath] }));
  tree.set(changePath(initialChange.id), record(initialChange));
  const originalRevision = await publish("original event", tree);

  tree.set(indexPath, index);
  tree.delete(notePath);
  tree.set(archivePath, originalNote.replace("status: active", "status: archived"));
  const renamed = { ...originalEntity, title: "Observation logging" };
  tree.set(entityPath, record(renamed));
  tree.set(changePath(correction.id), record(correction));
  const correctedRevision = await publish("rename, archive and correction", tree);

  tree.set(entityPath, record({ ...renamed, lifecycle: "removed" }));
  tree.set(changePath(reversal.id), record(reversal));
  const reversedRevision = await publish("removed entity and reversal", tree);
  const latestValid = await publish("identical accepted records on another source revision", tree);

  const rewritten = new Map(tree);
  rewritten.set(changePath(initialChange.id), record({ ...initialChange, summary: "Invisible rewrite" }));
  await publish("reject silent rewrite", rewritten, latestValid);
  const removed = new Map(tree);
  removed.delete(changePath(initialChange.id));
  const rejectedRevision = await publish("reject silent record removal", removed, latestValid);

  console.log(JSON.stringify({ originalRevision, correctedRevision, reversedRevision, latestValid, rejectedRevision, notePath, originalText }));
}

try {
  await verifyProductHistory();
} catch {
  console.error("Controlled product history fixture failed during " + phase + ".");
  process.exitCode = 1;
} finally {
  await closeRuntime();
}
