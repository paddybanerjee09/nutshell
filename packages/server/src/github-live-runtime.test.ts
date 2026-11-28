import { generateKeyPairSync, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { loadConfig, requireLocalDatabaseUrl } from "./config.ts";
import type { GitHubRepositoryAccess } from "./github-app-repository.ts";
import { createGitHubLiveOnboarding } from "./github-live-onboarding.ts";
import { closeRuntime, connectGitHubRepository, getAuth, listGitHubConnections, listRepositories } from "./runtime.ts";
import { account, session, user } from "./schema.ts";
import { migrateLiveDatabase } from "./setup.ts";

const connection = { repositoryId: 523611, installationId: 428191 };

async function proveControlledAssociation(connectionString: string, databaseName: string) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    expect((await client.query("SELECT current_database() AS name")).rows).toEqual([{ name: databaseName }]);
    const db = drizzle(client);
    const owner = { userId: "controlled-owner", sessionId: "controlled-owner-session", githubId: 76541, token: "ghu_controlled_owner" };
    const reader = { userId: "controlled-reader", sessionId: "controlled-reader-session", githubId: 87652, token: "ghu_controlled_reader" };
    await db.insert(user).values([owner, reader].map(({ userId }) => ({
      id: userId, email: `${userId}@nutshell.invalid`, name: userId,
    })));
    await db.insert(session).values([owner, reader].map(({ sessionId, userId }) => ({
      id: sessionId, userId, token: `${sessionId}-token`, expiresAt: new Date(Date.now() + 60_000),
    })));
    await db.insert(account).values([owner, reader].map(({ userId, githubId }) => ({
      id: userId + "-account", userId, accountId: String(githubId), providerId: "github",
    })));

    const identity = { id: connection.repositoryId, installationId: connection.installationId, ownerId: 95433,
      nodeId: "R_ephemeral_controlled", owner: "sample-owner", name: "sample-private-repo", defaultBranch: "trunk" };
    const lookup = vi.fn(async (token: string): Promise<GitHubRepositoryAccess> => {
      const configure = token === owner.token;
      return { identity, userId: (configure ? owner : reader).githubId, role: configure ? "admin" : "read",
        canRead: true, canWrite: configure, canConfigure: configure };
    });
    const service = createGitHubLiveOnboarding(db, {
      getAccessToken: async (userId) => {
        const actor = [owner, reader].find((candidate) => candidate.userId === userId);
        return actor ? { status: "ready", accessToken: actor.token, accountId: String(actor.githubId) } : { status: "reauthorize" };
      },
      repository: {
        discoverConnections: async () => ({ userId: owner.githubId, installationUrl: "https://github.com/apps/nutshell-smoke/installations/new",
          candidates: [{ ...connection, owner: identity.owner, name: identity.name }] }),
        verifyCurrentUserAccess: lookup,
      },
    });
    expect(await service.list(owner)).toMatchObject({ status: "ready", candidates: [{ ...connection, owner: identity.owner, name: identity.name }] });
    expect(await service.connect(reader, connection)).toEqual({ status: "denied" });
    expect((await client.query("SELECT id FROM provider_installation")).rows).toEqual([]);

    const connected = { status: "connected", repositoryId: String(connection.repositoryId) };
    expect(await service.connect(owner, connection)).toEqual(connected);
    expect(await service.connect(owner, connection)).toEqual(connected);
    expect(await service.connect(reader, connection)).toEqual(connected);
    expect((await client.query(`SELECT installation_id::int, name, connection_epoch, owner_id::int, repository_node_id
      FROM repository JOIN github_repository_association ON repository_id = id WHERE id = $1`, [connection.repositoryId])).rows).toEqual([{
      installation_id: connection.installationId, name: `${identity.owner}/${identity.name}`, connection_epoch: 1,
      owner_id: identity.ownerId, repository_node_id: identity.nodeId,
    }]);

    await client.query("UPDATE repository_membership SET active = false WHERE repository_id = $1 AND user_id = $2", [connection.repositoryId, reader.userId]);
    expect(await service.connect(reader, connection)).toEqual({ status: "denied" });
    expect((await client.query("SELECT user_id, active FROM repository_membership WHERE repository_id = $1 ORDER BY user_id", [connection.repositoryId])).rows)
      .toEqual([{ user_id: owner.userId, active: true }, { user_id: reader.userId, active: false }]);
  } finally {
    await client.end();
  }
}

test.skipIf(process.env.NUTSHELL_VERIFY !== "1")("starts live GitHub auth unseeded and associates only verified repositories in PostgreSQL", async (context) => {
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
    expect(await listGitHubConnections(new Headers())).toEqual({ status: "unavailable" });
    expect(await connectGitHubRepository(new Headers(), connection)).toEqual({ status: "unavailable" });

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
    await proveControlledAssociation(config.databaseUrl, name);
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
