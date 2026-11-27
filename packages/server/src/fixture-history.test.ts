import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import { canonicalRepositoryChange, type RepositoryChange, type RepositoryEntity } from "@nutshell/core/snapshot";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { readFixtureHistoryMemory, readFixtureProductHistory } from "./fixture-history.ts";
import { acceptFixtureDelivery, processNextFixtureDelivery, setFixtureHead, type FixtureFile } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

const repositoryId = 1002;
const repositoryKey = String(repositoryId);
const installationId = 2002;
const notePath = "nutshell-vault/features/nutshell-setup/CONTEXT.md";
const entityId = "ent_history_verification";
const changePath = (id: string) => ".nutshell/changes/" + id + ".json";

type OriginalState = {
  head_revision: string;
  indexed_revision: string | null;
  indexed_epoch: number | null;
  indexed_schema_version: number | null;
  indexed_policy_version: number | null;
};

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("durable fixture product history", { timeout: 30_000 }, () => {
  const originalId = "chg_history_" + randomUUID();
  const correctionId = "chg_history_" + randomUUID();
  const sessions: string[] = [];
  const deliveries: string[] = [];
  const revisions = new Set<string>();
  let db: pg.Pool;
  let origin: string;
  let originalState: OriginalState | undefined;
  let capturedOriginalState = false;

  beforeAll(async () => {
    const config = loadConfig();
    await migrateAndSeed(config.databaseUrl);
    origin = config.origin;
    db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 15_000 });
    const { rows } = await db.query<OriginalState>("SELECT * FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    originalState = rows[0];
    capturedOriginalState = true;
  }, 20_000);

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    if (!capturedOriginalState) return db.end();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM fixture_history_entry WHERE repository_id = $1 AND id = ANY($2)", [repositoryId, [originalId, correctionId]]);
      await client.query("DELETE FROM fixture_delivery WHERE repository_id = $1 AND id = ANY($2)", [repositoryId, deliveries]);
      if (originalState) {
        const { head_revision, indexed_revision, indexed_epoch, indexed_schema_version, indexed_policy_version } = originalState;
        await client.query("UPDATE fixture_state SET head_revision = $2, indexed_revision = $3, indexed_epoch = $4, indexed_schema_version = $5, indexed_policy_version = $6 WHERE repository_id = $1",
          [repositoryId, head_revision, indexed_revision, indexed_epoch, indexed_schema_version, indexed_policy_version]);
      } else {
        await client.query("DELETE FROM fixture_state WHERE repository_id = $1", [repositoryId]);
      }
      await client.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = ANY($2)", [repositoryId, [...revisions]]);
      await client.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
      await client.query("COMMIT");
    } finally {
      client.release(true);
      await db.end();
    }
  }, 20_000);

  async function login(persona: "coordinator" | "other") {
    const response = await getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ persona }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    const headers = new Headers({ Cookie: cookie!.split(";", 1)[0]! });
    const sessionId = (await getSession(headers))?.session.id;
    if (sessionId) sessions.push(sessionId);
    return headers;
  }

  async function publish(files: readonly FixtureFile[], revision = randomBytes(20).toString("hex")) {
    await setFixtureHead(repositoryId, revision, files);
    revisions.add(revision);
    const deliveryId = randomUUID();
    deliveries.push(deliveryId);
    expect(await acceptFixtureDelivery({ repositoryId, installationId, deliveryId, revision })).toBe("accepted");
    for (let attempt = 0; attempt < 24; attempt++) {
      if (!await processNextFixtureDelivery()) break;
      const { rows } = await db.query<{ status: string; failure_code: string | null }>(
        "SELECT status, failure_code FROM fixture_delivery WHERE id = $1", [deliveryId]);
      if (rows[0] && rows[0].status !== "queued") return { revision, ...rows[0] };
    }
    throw new Error("The test fixture delivery did not finish.");
  }

  it("retains original bytes and labels, records a linked correction, and rejects accepted mutation or removal", async () => {
    const user = await login("other");
    const outsider = await login("coordinator");
    const { rows: existing } = await db.query<{ id: string; payload: RepositoryChange }>(
      "SELECT id, payload FROM fixture_history_entry WHERE repository_id = $1", [repositoryId]);
    const base = buildFixtureSetupTree([
      { path: "AGENTS.md", body: "# History fixture instructions\n" },
      { path: "README.md", body: "# History verification fixture\n" },
      { path: "SPEC.md", body: "# Scope\n\nVerify preserved source history.\n" },
    ], { name: "History verification fixture", description: "Retain an original observation.", entityId })
      .filter(({ path }) => !path.startsWith(".nutshell/changes/"));
    const originalNote = base.find(({ path }) => path === notePath)!.body;
    const original: RepositoryChange = {
      schema_version: 1, id: originalId, entity_ids: [entityId], change_type: "added",
      summary: "Recorded the original observation.", product_impact: "user_visible",
      rationale: "Preserve the first indexed sample.", technical_summary: "Add the original note.",
      memory_paths: [notePath], evidence: [],
    };
    const files = [
      ...base,
      ...existing.map(({ id, payload }) => ({ path: changePath(id), body: canonicalRepositoryChange(payload) })),
      { path: changePath(originalId), body: JSON.stringify(original) },
    ];
    const first = await publish(files);
    expect(first.status).toBe("published");
    const history = await readFixtureProductHistory(user, repositoryKey);
    const event = history?.entries.find(({ id }) => id === originalId);
    expect(history).toMatchObject({ status: "current", revision: first.revision });
    expect(event).toMatchObject({
      change: original, sourceRevision: first.revision, observation: "indexed",
      entities: [{ id: entityId, title: "History verification fixture", kind: "module", kindLabel: "Module" }],
    });
    const { rows: digest } = await db.query<{ payload_sha256: string }>(
      "SELECT payload_sha256 FROM fixture_history_entry WHERE repository_id = $1 AND id = $2", [repositoryId, originalId]);
    expect(digest[0]?.payload_sha256).toBe(createHash("sha256").update(canonicalRepositoryChange(original)).digest("hex"));

    const correction: RepositoryChange = {
      ...original, id: correctionId, change_type: "corrected", summary: "Correct the observation.",
      memory_paths: [], corrects_change_id: originalId,
    };
    const updated = [
      ...files.filter(({ path }) => path !== notePath).map(({ path, body }) => {
        if (path === "nutshell-vault/_INDEX.md") return { path, body: body.split("\n").filter((line) => !line.includes(notePath)).join("\n") };
        if (path !== ".nutshell/entities/" + entityId + ".json") return { path, body };
        const entity = JSON.parse(body) as RepositoryEntity;
        return { path, body: JSON.stringify({ ...entity, title: "Renamed verification fixture", lifecycle: "removed", memory_paths: [] }) };
      }),
      { path: "nutshell-vault/archive/" + originalId + ".md", body: originalNote.replace("status: active", "status: archived") },
      { path: changePath(correctionId), body: JSON.stringify(correction) },
    ];
    const second = await publish(updated);
    expect(second.status).toBe("published");
    expect((await publish(updated, second.revision)).status).toBe("published");
    await closeRuntime();
    const later = await readFixtureProductHistory(user, repositoryKey);
    expect(later?.entries.filter(({ id }) => id === originalId)).toEqual([event]);
    expect(later?.entries.filter(({ id }) => id === correctionId)).toMatchObject([
      { change: correction, sourceRevision: second.revision, entities: [{ title: "Renamed verification fixture" }] },
    ]);
    expect(await readFixtureHistoryMemory(user, repositoryKey, originalId, notePath))
      .toEqual({ path: notePath, markdown: originalNote, sourceRevision: first.revision });
    expect(await readFixtureHistoryMemory(user, repositoryKey, originalId, "README.md")).toBeNull();
    expect(await readFixtureHistoryMemory(outsider, repositoryKey, originalId, notePath)).toBeNull();
    expect(await readFixtureProductHistory(outsider, repositoryKey)).toBeNull();
    expect(await readFixtureProductHistory(new Headers(), repositoryKey)).toBeNull();

    const rewritten = updated.map((file) => file.path === changePath(originalId)
      ? { ...file, body: JSON.stringify({ ...original, summary: "Silently overwrite the original." }) }
      : file);
    for (const invalid of [rewritten, updated.filter(({ path }) => path !== changePath(originalId))]) {
      expect(await publish(invalid)).toMatchObject({ status: "invalid", failure_code: "invalid_history" });
      expect(await readFixtureProductHistory(user, repositoryKey)).toEqual({ ...later, status: "invalid" });
    }
  });
});
