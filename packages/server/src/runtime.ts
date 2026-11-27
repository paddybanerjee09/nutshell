import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, asc, eq, exists, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import {
  createGitHubAppAdapter, createGitHubAppAuthOptions, createGitHubAppDrizzleTokenStore, createGitHubAppUserTokens,
} from "./github-app.ts";
import { createGitHubLiveAccessResolver } from "./github-live-access.ts";
import { personas } from "./local-fixtures.ts";
import {
  account, githubRepositoryAssociation, installation, membership, providerGrant, repository, session, user, verification,
} from "./schema.ts";

function localPersonaPlugin(origin: string) {
  return {
    id: "nutshell-local-persona",
    endpoints: {
      selectNutshellPersona: createAuthEndpoint("/nutshell/persona", {
        method: "POST",
        requireRequest: true,
        body: z.strictObject({ persona: z.enum(["coordinator", "reader", "other"]) }),
        metadata: { noStore: true },
      }, async (context) => {
        const request = context.request;
        if (!request || request.headers.get("origin") !== origin || new URL(request.url).origin !== origin) {
          throw new APIError("FORBIDDEN", { message: "A same-origin local request is required." });
        }
        const adapter = context.context.internalAdapter;
        const identity = await adapter.findUserById(personas[context.body.persona].id);
        if (!identity) {
          throw new APIError("SERVICE_UNAVAILABLE", { message: "Run local setup to create the fixture identities." });
        }
        const createdSession = await adapter.createSession(identity.id);
        if (!createdSession) {
          throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not start the local session." });
        }
        await setSessionCookie(context, { session: createdSession, user: identity });
        return context.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}

function createRuntime() {
  const config = loadConfig();
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true,
    max: 5,
  });
  pool.on("error", () => console.error("An idle Nutshell database connection failed."));
  const db = drizzle(pool);
  const database = drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } });
  const auth = config.mode === "live"
    ? betterAuth(createGitHubAppAuthOptions({ origin: config.origin, authSecret: config.authSecret, app: config.githubApp }, { database }))
    : betterAuth({
      database,
      baseURL: config.origin,
      secret: config.authSecret,
      trustedOrigins: [config.origin],
      advanced: {
        useSecureCookies: false,
        disableOriginCheck: false,
        disableCSRFCheck: false,
      },
      session: { cookieCache: { enabled: false } },
      plugins: [localPersonaPlugin(config.origin)],
    });
  const github = config.mode === "live" ? {
    repository: createGitHubAppAdapter(config.githubApp).repository,
    async getAccessToken(userId: string) {
      const { secretConfig } = await auth.$context;
      return createGitHubAppUserTokens({
        app: config.githubApp,
        store: createGitHubAppDrizzleTokenStore(db),
        encryptionKey: secretConfig,
      }).getAccessToken(userId);
    },
  } : undefined;
  return { db, auth, config, pool, github };
}

let runtime: ReturnType<typeof createRuntime> | undefined;

function getRuntime() {
  runtime ??= createRuntime();
  return runtime;
}

export function getAuth() {
  return getRuntime().auth;
}

export async function getSession(headers: Headers) {
  return getAuth().api.getSession({ headers });
}

export async function healthCheck(): Promise<void> {
  await getRuntime().db.select({ id: repository.id }).from(repository).limit(1);
}

export async function closeRuntime(): Promise<void> {
  const previous = runtime;
  runtime = undefined;
  await previous?.pool.end();
}

export type Repository = { id: string; name: string; description: string; role?: string };

export function getFixtureDatabase() {
  const { config, db } = getRuntime();
  if (config.mode !== "local-alpha" || config.deployment !== "local") throw new Error("Fixture access requires local alpha mode.");
  return db;
}

type FixtureDatabase = ReturnType<typeof getFixtureDatabase>;
export type FixtureTransaction = Parameters<Parameters<FixtureDatabase["transaction"]>[0]>[0];

function activeInstallation() {
  return and(eq(installation.id, repository.installationId), eq(installation.active, true));
}

function activeMembership(userId: string) {
  return and(eq(membership.repositoryId, repository.id), eq(membership.userId, userId), eq(membership.active, true));
}

function readableGrant(userId: string) {
  return and(eq(providerGrant.repositoryId, repository.id), eq(providerGrant.userId, userId), eq(providerGrant.canRead, true));
}

function activeRepositoryFilter(userId: string, id?: number) {
  const { db } = getRuntime();
  return and(
    eq(repository.active, true),
    id === undefined ? undefined : eq(repository.id, id),
    exists(db.select({ id: installation.id }).from(installation).where(activeInstallation())),
    exists(db.select({ id: membership.repositoryId }).from(membership).where(activeMembership(userId))),
  );
}

function repositoryAccessFilter(userId: string, id?: number) {
  const { db } = getRuntime();
  return and(activeRepositoryFilter(userId, id),
    exists(db.select({ id: providerGrant.repositoryId }).from(providerGrant).where(readableGrant(userId))),
  );
}

export async function resolveRepositoryActor(headers: Headers) {
  const auth = await getSession(headers);
  return auth ? { userId: auth.user.id, sessionId: auth.session.id } : null;
}

export type RepositoryActor = NonNullable<Awaited<ReturnType<typeof resolveRepositoryActor>>>;

export async function lockRepositoryGrant(tx: FixtureTransaction, actor: RepositoryActor, repositoryId: number) {
  // Lock authorization facts so a concurrent revocation cannot commit before this operation.
  const [grant] = await tx.select({ canWrite: providerGrant.canWrite, canConfigure: providerGrant.canConfigure }).from(repository)
    .innerJoin(installation, activeInstallation()).innerJoin(membership, activeMembership(actor.userId))
    .innerJoin(providerGrant, readableGrant(actor.userId))
    .innerJoin(session, and(eq(session.userId, actor.userId), eq(session.id, actor.sessionId), gt(session.expiresAt, sql`now()`)))
    .where(and(eq(repository.id, repositoryId), eq(repository.active, true)))
    .for("share", { of: [session, membership, providerGrant] });
  return grant ? { canWrite: grant.canWrite, canConfigure: grant.canWrite && grant.canConfigure } : null;
}

export async function resolveRepositoryReadFilter(headers: Headers, id: string) {
  if (getRuntime().config.mode !== "local-alpha") return undefined;
  const numericId = Number(id);
  if (!/^[1-9]\d{0,15}$/u.test(id) || !Number.isSafeInteger(numericId)) return undefined;
  const actor = await resolveRepositoryActor(headers);
  return actor ? repositoryAccessFilter(actor.userId, numericId) : undefined;
}

async function authorizedGitHubRepositories(actor: RepositoryActor, id?: number): Promise<Repository[]> {
  const { db, github } = getRuntime();
  if (!github) return [];
  const [githubAccount, duplicate] = await db.select({ accountId: account.accountId }).from(account)
    .where(and(eq(account.userId, actor.userId), eq(account.providerId, "github"))).limit(2);
  if (!githubAccount || duplicate) return [];

  const associations = await db.select({
    repositoryId: repository.id,
    installationId: repository.installationId,
    ownerId: githubRepositoryAssociation.ownerId,
    repositoryNodeId: githubRepositoryAssociation.repositoryNodeId,
    connectionEpoch: repository.connectionEpoch,
  }).from(repository).innerJoin(githubRepositoryAssociation, eq(repository.id, githubRepositoryAssociation.repositoryId))
    .where(activeRepositoryFilter(actor.userId, id)).orderBy(asc(repository.name), asc(repository.id));
  const resolver = createGitHubLiveAccessResolver({
    getAccessToken: github.getAccessToken,
    verifyCurrentUserAccess: github.repository.verifyCurrentUserAccess,
  });
  const authorized: Repository[] = [];
  for (let offset = 0; offset < associations.length; offset += 4) {
    const batch = await Promise.all(associations.slice(offset, offset + 4).map(async (association) => {
      const result = await resolver.resolve({ userId: actor.userId, accountId: githubAccount.accountId, association });
      if (result.status !== "ready") return null;
      // Provider requests can finish after a local revocation or re-association. Recheck the exact local identity.
      const [current] = await db.select({ name: repository.name, description: repository.description }).from(repository)
        .innerJoin(githubRepositoryAssociation, eq(repository.id, githubRepositoryAssociation.repositoryId))
        .where(and(
          activeRepositoryFilter(actor.userId, association.repositoryId),
          eq(repository.installationId, association.installationId),
          eq(repository.connectionEpoch, association.connectionEpoch),
          eq(githubRepositoryAssociation.ownerId, association.ownerId),
          eq(githubRepositoryAssociation.repositoryNodeId, association.repositoryNodeId),
          exists(db.select({ id: session.id }).from(session).where(and(
            eq(session.userId, actor.userId), eq(session.id, actor.sessionId), gt(session.expiresAt, sql`now()`),
          ))),
          exists(db.select({ id: account.id }).from(account).where(and(
            eq(account.userId, actor.userId), eq(account.providerId, "github"), eq(account.accountId, githubAccount.accountId),
          ))),
        ));
      return current ? { id: String(association.repositoryId), ...current, role: result.access.role } : null;
    }));
    for (const row of batch) if (row) authorized.push(row);
  }
  return authorized;
}

async function authorizedRepositories(userId: string, id?: number): Promise<Repository[]> {
  const rows = await getRuntime().db.select({
    id: repository.id, name: repository.name, description: repository.description,
  }).from(repository).where(repositoryAccessFilter(userId, id))
    .orderBy(asc(repository.name), asc(repository.id));

  return rows.map((row) => ({ ...row, id: String(row.id) }));
}

export async function listRepositories(headers: Headers): Promise<Repository[] | null> {
  const actor = await resolveRepositoryActor(headers);
  if (!actor) return null;
  return getRuntime().config.mode === "live"
    ? authorizedGitHubRepositories(actor)
    : authorizedRepositories(actor.userId);
}

export async function readRepository(headers: Headers, id: string): Promise<Repository | null> {
  if (getRuntime().config.mode === "live") {
    const numericId = Number(id);
    if (!/^[1-9]\d{0,15}$/u.test(id) || !Number.isSafeInteger(numericId)) return null;
    const actor = await resolveRepositoryActor(headers);
    if (!actor) return null;
    const [result] = await authorizedGitHubRepositories(actor, numericId);
    return result ?? null;
  }
  const filter = await resolveRepositoryReadFilter(headers, id);
  if (!filter) return null;
  const [result] = await getRuntime().db.select({ name: repository.name, description: repository.description })
    .from(repository).where(filter);
  return result ? { id, ...result } : null;
}
