import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadConfig } from "@nutshell/server/config";
import { isFixtureRevision, readFixtureTree, setFixtureHead } from "@nutshell/server/fixture-sync";
import { closeRuntime, getFixtureDatabase } from "@nutshell/server/runtime";
import { readScreenshotAsset, recordFixtureScreenshotCapture } from "@nutshell/server/screenshot-assets";
import { sendFixturePush } from "../apps/web/src/app/api/fixture-push.ts";
import type { RepositoryChange } from "../packages/core/src/repo-snapshot.ts";

async function publishScreenshotEvidence() {
  assert.equal(process.env.NUTSHELL_VERIFY, "1");
  const config = loadConfig();
  assert.equal(config.databaseUrl, config.testDatabaseUrl);
  assert.ok(config.webhookSecret, "The fixture webhook secret is required.");
  const [sourceRevision, uploadedAssetId, capturedAt] = process.argv.slice(2);
  assert.ok(isFixtureRevision(sourceRevision) && uploadedAssetId && capturedAt, "Expected a fixture revision, asset ID, and capture time.");

  const repositoryId = 1001;
  const route = "/app/repos/1001/workspace";
  const session = await fetch(config.origin + "/api/auth/nutshell/persona", {
    method: "POST",
    headers: { origin: config.origin, "content-type": "application/json" },
    body: JSON.stringify({ persona: "coordinator" }),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(session.status, 200);
  const cookies = session.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookies, "The fixture coordinator session is required.");
  const headers = new Headers({ cookie: cookies });
  const uploaded = await readScreenshotAsset(headers, String(repositoryId), uploadedAssetId);
  assert.ok(uploaded.status === "ready" && uploaded.asset.provenance === "declared", "Expected a declared fixture upload.");
  const declaration = {
    sourceRevision, route, state: "workspace-indexed",
    viewport: { width: 1440, height: 900 }, environment: "local-alpha", capturedAt,
  };
  const capture = await recordFixtureScreenshotCapture(headers, String(repositoryId), {
    mimeType: "image/png", bytes: await readFile(".local/verification/private-evidence-fixture.png"), declaration,
  });
  assert.ok(capture.status === "ready" && capture.asset.provenance === "fixture_capture" && capture.asset.captureRef,
    "The controlled fixture capture must match the indexed workspace.");

  const files = await getFixtureDatabase().transaction((tx) => readFixtureTree(tx, repositoryId, sourceRevision));
  assert.ok(files?.length, "Expected the indexed fixture tree.");
  const reference = {
    kind: "screenshot" as const, source_revision: sourceRevision, route,
    viewport: declaration.viewport, environment: declaration.environment, captured_at: capturedAt,
  };
  const change: RepositoryChange = {
    schema_version: 1, id: "chg_private_screenshot_fixture", entity_ids: ["feat_observation_capture"],
    change_type: "changed", summary: "Inspect screenshot evidence for observation capture.",
    product_impact: "none", rationale: "Verify authorized evidence delivery and provenance.",
    technical_summary: "Attach a declared upload, a controlled local capture, and an unavailable asset.",
    memory_paths: [], evidence: [
      { ...reference, asset_id: uploadedAssetId, state: "Uploaded workspace image" },
      { ...reference, asset_id: capture.asset.id, state: declaration.state, capture_ref: capture.asset.captureRef },
      { ...reference, asset_id: "asset_missing_screenshot_fixture", state: "Unavailable workspace image" },
    ],
  };
  const revision = randomBytes(20).toString("hex");
  await setFixtureHead(repositoryId, revision, [
    ...files,
    { path: ".nutshell/changes/" + change.id + ".json", body: JSON.stringify(change) + "\n" },
  ]);
  assert.ok(await sendFixturePush(config.origin, config.webhookSecret, {
    deliveryId: randomUUID(), repositoryId, installationId: 2001, revision,
  }), "Signed private-evidence publication was not accepted.");
  console.log(revision);
}

try {
  await publishScreenshotEvidence();
} catch {
  console.error("Controlled screenshot fixture verification failed.");
  process.exitCode = 1;
} finally {
  await closeRuntime();
}
