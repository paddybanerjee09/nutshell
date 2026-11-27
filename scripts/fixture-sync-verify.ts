import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "@nutshell/server/config";
import { setFixtureHead } from "@nutshell/server/fixture-sync";
import { closeRuntime } from "@nutshell/server/runtime";

type CurrentSnapshot = {
  status: string;
  headRevision: string | null;
  revision: string | null;
  snapshot: { entities: { id: string; title: string }[]; documents: { path: string; markdown: string }[] } | null;
};

function fixtureNote(id: string, context: string, decision: string, metadata = "") {
  return [
    "---",
    "id: " + id,
    'date: "2026-11-26"',
    "status: active",
    "tags: [fixture]",
    metadata + "---",
    "",
    "## Context",
    context,
    "",
    "## Decision",
    decision,
    "",
    "## Consequences",
    "This observation belongs to the simulated provider fixture.",
    "",
    "## Affected files",
    "- src/index.ts",
    "",
  ].join("\n");
}

function fixtureTree(name: string, id: string) {
  const note = "notes/" + id + ".md";
  const notePath = "nutshell-vault/" + note;
  const rows = [
    "| Path | Description | Status | Tags |",
    "| --- | --- | --- | --- |",
    ...["AGENTS.md", "README.md", "SPEC.md"].map((file) => `| [${file}](../${file}) | Fixture reference | active | fixture |`),
    ...["_INDEX.md", "CURRENT_TASK.md", note].map((file) => `| [nutshell-vault/${file}](${file}) | Fixture note | active | fixture |`),
  ].join("\n");
  const task = [
    "task_id: null", "task_state: idle", "task_revision: 0", "repository_id: null", "branch: null",
    "base_branch: null", "pr_number: null", "pr_url: null", "last_verified_head: null",
    "lead_agent: null", "integration_checkout: null", "cleanup_pr_url: null", "",
  ].join("\n");
  const files: [string, string][] = [
    ["AGENTS.md", "# Fixture instructions\nRead the vault index and current task before context.\n"],
    ["README.md", "# " + name + "\nSimulated provider verification fixture.\n"],
    ["SPEC.md", "# Fixture scope\nA single synthetic feature and change.\n"],
    ["nutshell-vault/_INDEX.md", fixtureNote(id + "-index", "Routes synthetic repository memory.", rows)],
    ["nutshell-vault/CURRENT_TASK.md", fixtureNote(id + "-task", "No fixture work is active.", "Preserve fixture-only task state.", task)],
    [notePath, fixtureNote(id + "-notes", name, "Collect a synthetic observation.")],
    ["src/index.ts", "export const fixtureName = " + JSON.stringify(name) + ";\n"],
    [".nutshell/config.json", JSON.stringify({
      schema_version: 1,
      vault_root: "nutshell-vault",
      entity_kinds: ["feature", "screen", "service", "module"].map((slug) => ({ slug, label: slug })),
      coverage: { include: ["src/**"], exclude: [] },
    })],
    [".nutshell/entities/" + id + ".json", JSON.stringify({
      schema_version: 1, id, kind: "feature", title: name, summary: "A synthetic feature.",
      lifecycle: "active", code_paths: ["src/index.ts"], memory_paths: [notePath], relations: [],
    })],
    [".nutshell/changes/chg_" + id + ".json", JSON.stringify({
      schema_version: 1, id: "chg_" + id, entity_ids: [id], change_type: "added",
      summary: "Add the fixture view.", product_impact: "user_visible",
      rationale: "Exercise validated snapshot publication.", technical_summary: "Add the fixture source and note.",
      memory_paths: [notePath], evidence: [],
    })],
  ];
  return files.map(([path, body]) => ({ path, body }));
}

async function verifyFixtureSync() {
  const { origin, mode, databaseUrl, testDatabaseUrl, webhookSecret } = loadConfig();
  assert.equal(process.env.NUTSHELL_VERIFY, "1", "Fixture verification requires the isolated test database.");
  assert.equal(mode, "local-alpha");
  assert.ok(databaseUrl === testDatabaseUrl, "Fixture verification resolved a non-test database.");
  assert.ok(webhookSecret, "Run alpha:setup to create NUTSHELL_WEBHOOK_SECRET.");

  async function cookie(persona: "coordinator" | "other") {
    const result = await fetch(origin + "/api/auth/nutshell/persona", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ persona }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(result.status, 200);
    const session = result.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    assert.ok(session);
    return session;
  }

  async function snapshot(repositoryId: number, session?: string) {
    return fetch(origin + "/api/repos/" + repositoryId + "/snapshot", {
      headers: session ? { cookie: session } : {},
      signal: AbortSignal.timeout(10_000),
    });
  }

  async function waitForSnapshot(repositoryId: number, session: string, revision: string, status: string) {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const result = await snapshot(repositoryId, session);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get("x-nutshell-provider"), "fixture");
      assert.match(result.headers.get("cache-control") ?? "", /no-store/);
      const projection = await result.json() as CurrentSnapshot;
      if (projection.headRevision === revision && projection.status === status) return projection;
      await delay(250);
    }
    throw new Error("Fixture snapshot did not reach " + status + " for repository " + repositoryId + ".");
  }

  async function deliver(repositoryId: number, after: string, deliveryId: string, valid = true) {
    const body = JSON.stringify({ ref: "refs/heads/main", after, repository: { id: repositoryId }, installation: { id: repositoryId + 1000 } });
    const hmac = createHmac("sha256", webhookSecret!).update(body).digest("hex");
    return fetch(origin + "/api/github/webhook", {
      method: "POST", body,
      headers: {
        "content-type": "application/json", "x-github-event": "push", "x-github-delivery": deliveryId,
        "x-hub-signature-256": "sha256=" + (valid ? hmac : "0".repeat(64)),
      },
      signal: AbortSignal.timeout(10_000),
    });
  }

  const [fieldSession, harborSession] = await Promise.all([cookie("coordinator"), cookie("other")]);
  const field = fixtureTree("Field Notes", "field-notes");
  const harbor = fixtureTree("Harbor Atlas", "harbor-atlas");
  const fieldRevision = randomBytes(20).toString("hex");
  const harborRevision = randomBytes(20).toString("hex");
  await setFixtureHead(1001, fieldRevision, field);
  await setFixtureHead(1002, harborRevision, harbor);
  const delivery = randomUUID();
  assert.equal((await deliver(1001, fieldRevision, delivery, false)).status, 401);
  for (const expected of ["accepted", "duplicate"]) {
    const result = await deliver(1001, fieldRevision, delivery);
    assert.equal(result.status, 202);
    assert.deepEqual(await result.json(), { status: expected });
  }
  assert.equal((await deliver(1002, harborRevision, randomUUID())).status, 202);
  const [publishedField, publishedHarbor] = await Promise.all([
    waitForSnapshot(1001, fieldSession, fieldRevision, "current"),
    waitForSnapshot(1002, harborSession, harborRevision, "current"),
  ]);
  assert.equal(publishedField.revision, fieldRevision);
  assert.equal(publishedField.snapshot?.entities[0]?.title, "Field Notes");
  assert.equal(publishedHarbor.revision, harborRevision);
  assert.equal(publishedHarbor.snapshot?.entities[0]?.title, "Harbor Atlas");
  assert.equal((await snapshot(1002, fieldSession)).status, 404);
  assert.equal((await snapshot(1001)).status, 404);

  const invalidRevision = randomBytes(20).toString("hex");
  await setFixtureHead(1001, invalidRevision, field.map((file) => file.path === ".nutshell/config.json"
    ? { ...file, body: '{"schema_version":2}' }
    : file));
  assert.equal((await deliver(1001, invalidRevision, randomUUID())).status, 202);
  const invalid = await waitForSnapshot(1001, fieldSession, invalidRevision, "invalid");
  assert.equal(invalid.revision, fieldRevision);
  assert.deepEqual(invalid.snapshot, publishedField.snapshot);
  console.log("Signed fixture delivery, deduplication, authorized snapshots, and invalid-revision isolation passed.");
}

try {
  await verifyFixtureSync();
} finally {
  await closeRuntime();
}
