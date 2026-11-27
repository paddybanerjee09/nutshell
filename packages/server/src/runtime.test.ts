import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { closeRuntime, getAuth, getSession, healthCheck, listRepositories, readRepository } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL session and repository access", () => {
  let origin: string;
  let db: pg.Pool;
  let databaseUrl: string;

  beforeAll(async () => {
    ({ origin, databaseUrl } = loadConfig());
    await migrateAndSeed(databaseUrl);
    db = new pg.Pool({ connectionString: databaseUrl });
    await healthCheck();
  });

  afterAll(async () => {
    await closeRuntime();
    await db?.end();
  });

  function personaRequest(body: unknown, requestOrigin = origin) {
    return getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin },
      body: JSON.stringify(body),
    }));
  }

  async function enter(persona: "coordinator" | "reader" | "other") {
    const response = await personaRequest({ persona });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    expect(cookie).toContain("HttpOnly");
    return new Headers({ Cookie: cookie!.split(";", 1)[0]! });
  }

  it("rejects cross-origin requests and caller-selected roles", async () => {
    const crossOrigin = await personaRequest({ persona: "coordinator" }, "http://remote.example");
    expect(crossOrigin.status).toBe(403);
    expect(crossOrigin.headers.get("set-cookie")).toBeNull();
    const wrongShape = await personaRequest({ persona: "reader", role: "admin" });
    expect(wrongShape.status).toBe(400);
    expect(wrongShape.headers.get("set-cookie")).toBeNull();
  });

  it("uses durable Better Auth sessions and separates repository audiences", async () => {
    expect(await listRepositories(new Headers())).toBeNull();
    expect(await readRepository(new Headers(), "1001")).toBeNull();
    for (const [persona, visible, hidden] of [
      ["coordinator", "1001", "1002"],
      ["reader", "1001", "1002"],
      ["other", "1002", "1001"],
    ] as const) {
      const headers = await enter(persona);
      await closeRuntime();
      expect(await listRepositories(headers)).toEqual([expect.objectContaining({ id: visible })]);
      expect(await readRepository(headers, visible)).toMatchObject({ id: visible });
      expect(await readRepository(headers, hidden)).toBeNull();
      expect(await readRepository(headers, "01e3")).toBeNull();
      const session = await getSession(headers);
      expect(session?.user.id).toBe("local-" + persona);
      await db.query('DELETE FROM "auth_session" WHERE "id" = $1', [session?.session.id]);
      expect(await readRepository(headers, visible)).toBeNull();
    }
  });

  it("checks all repository access facts again and preserves revocation during setup", async () => {
    const headers = await enter("reader");
    expect(await readRepository(headers, "1001")).toMatchObject({ id: "1001" });
    await db.query(
      'UPDATE "local_provider_grant" SET "can_read" = false WHERE "repository_id" = 1001 AND "user_id" = $1',
      ["local-reader"],
    );
    try {
      await migrateAndSeed(databaseUrl);
      expect(await listRepositories(headers)).toEqual([]);
      expect(await readRepository(headers, "1001")).toBeNull();
    } finally {
      await db.query(
        'UPDATE "local_provider_grant" SET "can_read" = true WHERE "repository_id" = 1001 AND "user_id" = $1',
        ["local-reader"],
      );
    }
    await db.query('UPDATE "repository_membership" SET "active" = false WHERE "repository_id" = 1001 AND "user_id" = $1', [
      "local-reader",
    ]);
    try {
      expect(await readRepository(headers, "1001")).toBeNull();
    } finally {
      await db.query('UPDATE "repository_membership" SET "active" = true WHERE "repository_id" = 1001 AND "user_id" = $1', [
        "local-reader",
      ]);
    }
    await db.query('UPDATE "provider_installation" SET "active" = false WHERE "id" = 2001');
    try {
      expect(await readRepository(headers, "1001")).toBeNull();
    } finally {
      await db.query('UPDATE "provider_installation" SET "active" = true WHERE "id" = 2001');
    }
    expect(await readRepository(headers, "1001")).toMatchObject({ id: "1001" });
  });
});
