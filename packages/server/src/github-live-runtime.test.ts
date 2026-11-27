import { generateKeyPairSync, randomBytes } from "node:crypto";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { loadConfig, requireLocalDatabaseUrl } from "./config.ts";
import { closeRuntime, getAuth, listRepositories } from "./runtime.ts";
import { migrateLiveDatabase } from "./setup.ts";

test.skipIf(process.env.NUTSHELL_VERIFY !== "1")("starts GitHub auth on an unseeded PostgreSQL runtime", async (context) => {
  const controlUrl = requireLocalDatabaseUrl(process.env.TEST_DATABASE_URL, "Verification database", "nutshell_alpha_test");
  const name = "nutshell_live_smoke_" + randomBytes(6).toString("hex");
  const target = new URL(controlUrl);
  target.pathname = "/" + name;
  const control = new pg.Client({ connectionString: controlUrl, connectionTimeoutMillis: 10_000 });
  const privateKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey.toString();
  const liveEnv = {
    NUTSHELL_MODE: "live",
    NUTSHELL_DEPLOYMENT: "local",
    NUTSHELL_ORIGIN: "https://nutshell.test",
    NUTSHELL_VERIFY: "0",
    DATABASE_URL: target.href,
    GITHUB_APP_ID: "12345",
    GITHUB_APP_CLIENT_ID: "Iv1.synthetic",
    GITHUB_APP_CLIENT_SECRET: "local-smoke-client-secret",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_WEBHOOK_SECRET: "fixture-for-configured-smoke-only",
  };
  const outbound = vi.fn(async () => { throw new Error("External requests are disabled in this verification."); });
  let created = false;
  try {
    await control.connect();
    const privileges = await control.query<{ allowed: boolean }>(`
      SELECT (rolcreatedb OR rolsuper) AS allowed FROM pg_roles WHERE rolname = current_user
    `);
    // An already provisioned alpha database does not require a database-creation role.
    if (!privileges.rows[0]?.allowed) return context.skip();
    await control.query('CREATE DATABASE "' + name + '"');
    created = true;
    for (const [key, value] of Object.entries(liveEnv)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", outbound);

    const config = loadConfig();
    await migrateLiveDatabase(config.databaseUrl);
    const data = new pg.Client({ connectionString: config.databaseUrl, connectionTimeoutMillis: 10_000 });
    try {
      await data.connect();
      const result = await data.query(`
        SELECT (SELECT count(*)::int FROM auth_user) AS users,
               (SELECT count(*)::int FROM repository) AS repos,
               (SELECT count(*)::int FROM github_repository_association) AS associations
      `);
      expect(result.rows).toEqual([{ users: 0, repos: 0, associations: 0 }]);
    } finally {
      await data.end();
    }
    expect(await listRepositories(new Headers())).toBeNull();

    const send = (path: string, body: object) => getAuth().handler(new Request(config.origin + path, {
      method: "POST",
      headers: { origin: config.origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect((await send("/api/auth/nutshell/persona", { persona: "coordinator" })).status).toBe(404);
    const begin = await send("/api/auth/sign-in/social", { provider: "github", callbackURL: "/app", disableRedirect: true });
    expect(begin.status).toBe(200);
    expect(begin.headers.get("set-cookie")).toMatch(/Secure\b/u);
    expect(begin.headers.get("set-cookie")).toMatch(/HttpOnly\b/u);
    const authorization = new URL((await begin.json()).url);
    expect(authorization.origin).toBe("https://github.com");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    try {
      await closeRuntime();
    } finally {
      try {
        if (created) await control.query('DROP DATABASE "' + name + '"');
      } finally {
        await control.end();
      }
    }
  }
}, 60_000);
