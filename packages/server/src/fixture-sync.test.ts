import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { acceptFixtureDelivery, processNextFixtureDelivery, readFixtureSnapshot, setFixtureHead } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL fixture receipts", () => {
  const repositoryId = 1002;
  const installationId = 2002;
  const previousRevision = randomBytes(20).toString("hex");
  const nextRevision = randomBytes(20).toString("hex");
  const deliveries = [randomUUID(), randomUUID(), randomUUID()] as const;
  const malformedTree = [{ path: ".nutshell/config.json", body: "{" }];
  let db: pg.Pool;
  let origin: string;
  let originalHead: string | undefined;
  let sessionId: string | undefined;

  beforeAll(async () => {
    const config = loadConfig();
    origin = config.origin;
    await migrateAndSeed(config.databaseUrl);
    db = new pg.Pool({ connectionString: config.databaseUrl });
    const { rows } = await db.query<{ head_revision: string }>("SELECT head_revision FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    originalHead = rows[0]?.head_revision;
  });

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      const revisions = [previousRevision, nextRevision];
      if (originalHead) {
        await db.query("UPDATE fixture_state SET head_revision = $1 WHERE repository_id = $2 AND head_revision = ANY($3)", [originalHead, repositoryId, revisions]);
      } else {
        await db.query("DELETE FROM fixture_state WHERE repository_id = $1 AND head_revision = ANY($2)", [repositoryId, revisions]);
      }
      await db.query("DELETE FROM fixture_delivery WHERE id = ANY($1)", [deliveries]);
      await db.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = ANY($2)", [repositoryId, revisions]);
      if (sessionId) await db.query("DELETE FROM auth_session WHERE id = $1", [sessionId]);
    } finally {
      await db.end();
    }
  });

  it("deduplicates concurrent receipts and ignores work from an older head or connection epoch", async () => {
    const response = await getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ persona: "other" }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    expect(cookie).toBeDefined();
    const headers = new Headers({ Cookie: cookie!.split(";", 1)[0]! });
    sessionId = (await getSession(headers))?.session.id;

    await setFixtureHead(repositoryId, previousRevision, malformedTree);
    await expect(setFixtureHead(repositoryId, previousRevision, [{ path: malformedTree[0]!.path, body: "{}" }]))
      .rejects.toThrow("different immutable tree");
    const older = { repositoryId, installationId, deliveryId: deliveries[0], revision: previousRevision };
    expect((await Promise.all([acceptFixtureDelivery(older), acceptFixtureDelivery(older)])).sort()).toEqual(["accepted", "duplicate"]);
    await setFixtureHead(repositoryId, nextRevision, malformedTree);
    while (await processNextFixtureDelivery()) {
      // Process committed jobs without running the continuous worker.
    }
    const queued = { ...older, deliveryId: deliveries[1], revision: nextRevision };
    expect(await acceptFixtureDelivery(queued)).toBe("accepted");

    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    try {
      expect(await readFixtureSnapshot(headers, String(repositoryId))).toBeNull();
      expect(await acceptFixtureDelivery({ ...queued, deliveryId: deliveries[2] })).toBe("unavailable");
    } finally {
      await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    }

    const newEvent = { ...queued, deliveryId: deliveries[2] };
    expect(await acceptFixtureDelivery(newEvent)).toBe("accepted");
    while (await processNextFixtureDelivery()) {
      // Process committed jobs without running the continuous worker.
    }

    const { rows } = await db.query<{ id: string; status: string; connection_epoch: number }>(
      "SELECT id, status, connection_epoch FROM fixture_delivery WHERE id = ANY($1)", [deliveries],
    );
    const byDelivery = new Map(rows.map((row) => [row.id, row]));
    expect(byDelivery.get(deliveries[0])?.status).toBe("obsolete");
    expect(byDelivery.get(deliveries[1])?.status).toBe("obsolete");
    expect(byDelivery.get(deliveries[2])).toMatchObject({ status: "invalid", connection_epoch: byDelivery.get(deliveries[1])!.connection_epoch + 2 });
    expect(await readFixtureSnapshot(headers, String(repositoryId))).toEqual({
      status: "invalid", headRevision: nextRevision, revision: null, snapshot: null,
    });
  });
});
