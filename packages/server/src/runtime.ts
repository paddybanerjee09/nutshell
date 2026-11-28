import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { RepositoryProjection } from "@nutshell/core/snapshot";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, asc, eq, exists, gt, ne, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import {
  createGitHubAppAdapter, createGitHubAppAuthOptions, createGitHubAppDrizzleTokenStore, createGitHubAppUserTokens,
} from "./github-app.ts";
import type { GitHubSetupReadResult, GitHubSetupResult } from "./github-app-setup.ts";
import { createGitHubLiveAccessResolver, type GitHubLiveAssociation } from "./github-live-access.ts";
import {
  createGitHubLiveOnboarding, type ConnectGitHubRepositoryInput, type ConnectGitHubRepositoryResult, type GitHubConnectionsResult,
} from "./github-live-onboarding.ts";
import { personas } from "./local-fixtures.ts";
import {
  account, githubIndexState, githubRepositoryAssociation, githubSnapshot, installation, membership, providerGrant, repository, session, user,
  verification,
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
  const githubAdapter = config.mode === "live" ? createGitHubAppAdapter(config.githubApp) : undefined;
  const github = config.mode === "live" && githubAdapter ? {
    repository: githubAdapter.repository,
    setup: githubAdapter.setup,
    async getAccessToken(userId: string) {
      const { secretConfig } = await auth.$context;
      return createGitHubAppUserTokens({
        app: config.githubApp,
        store: createGitHubAppDrizzleTokenStore(db),
        encryptionKey: secretConfig,
      }).getAccessToken(userId);
    },
  } : undefined;
  const githubOnboarding = github && createGitHubLiveOnboarding(db, github);
  return { db, auth, config, pool, github, githubOnboarding };
}

let runtime: ReturnType<typeof createRuntime> | undefined;
type RuntimeDatabase = ReturnType<typeof createRuntime>["db"];

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

export type GitHubWorkspaceRead = {
  repository: Repository;
  userId: string;
  snapshot: {
    status: "pending" | "current" | "stale" | "invalid";
    headRevision: string;
    revision: string | null;
    snapshot: RepositoryProjection | null;
    indexedAt: string | null;
  };
};

export function getFixtureDatabase() {
  const { config, db } = getRuntime();
  if (config.mode !== "local-alpha" || config.deployment !== "local") throw new Error("Fixture access requires local alpha mode.");
  return db;
}

export type RepositoryTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];
export type FixtureTransaction = RepositoryTransaction;

export function getLiveSyncRuntime() {
  const { db, github } = getRuntime();
  if (!github) throw new Error("GitHub synchronization requires live configuration.");
  return { db, provider: github.repository };
}

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

export async function listGitHubConnections(headers: Headers): Promise<GitHubConnectionsResult> {
  const { githubOnboarding } = getRuntime();
  if (!githubOnboarding) return { status: "unavailable" };
  const actor = await resolveRepositoryActor(headers);
  return actor ? githubOnboarding.list(actor) : { status: "unavailable" };
}

export async function connectGitHubRepository(headers: Headers, input: ConnectGitHubRepositoryInput): Promise<ConnectGitHubRepositoryResult> {
  const { githubOnboarding } = getRuntime();
  if (!githubOnboarding) return { status: "unavailable" };
  const actor = await resolveRepositoryActor(headers);
  return actor ? githubOnboarding.connect(actor, input) : { status: "unavailable" };
}

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
  const [githubAccount, duplicate] = await linkedGitHubAccounts(db, actor.userId);
  if (!githubAccount || duplicate) return [];

  const associations = await liveAssociations(db, actor.userId, id);
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
      const [current] = await currentGitHubRepository(db, actor, association, githubAccount);
      return current ? { id: String(association.repositoryId), ...current, role: result.access.role } : null;
    }));
    for (const row of batch) if (row) authorized.push(row);
  }
  return authorized;
}

type LinkedGitHubAccount = { id: string; accountId: string };

function linkedGitHubAccounts(db: Pick<RuntimeDatabase, "select">, userId: string) {
  return db.select({ id: account.id, accountId: account.accountId }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github"))).limit(2);
}

function liveAssociations(db: RuntimeDatabase, userId: string, id?: number) {
  return db.select({
    repositoryId: repository.id, installationId: repository.installationId, ownerId: githubRepositoryAssociation.ownerId,
    repositoryNodeId: githubRepositoryAssociation.repositoryNodeId, connectionEpoch: repository.connectionEpoch,
  }).from(repository).innerJoin(githubRepositoryAssociation, eq(repository.id, githubRepositoryAssociation.repositoryId))
    .where(activeRepositoryFilter(userId, id)).orderBy(asc(repository.name), asc(repository.id));
}

function currentGitHubRepository(
  db: Pick<RuntimeDatabase, "select">, actor: RepositoryActor, association: GitHubLiveAssociation, linked: LinkedGitHubAccount,
) {
  const link = and(eq(account.userId, actor.userId), eq(account.providerId, "github"));
  return db.select({ name: repository.name, description: repository.description }).from(repository)
    .innerJoin(githubRepositoryAssociation, eq(repository.id, githubRepositoryAssociation.repositoryId))
    .innerJoin(installation, activeInstallation()).innerJoin(membership, activeMembership(actor.userId))
    .innerJoin(session, and(eq(session.userId, actor.userId), eq(session.id, actor.sessionId), gt(session.expiresAt, sql`clock_timestamp()`)))
    .innerJoin(account, and(link, eq(account.id, linked.id), eq(account.accountId, linked.accountId)))
    .where(and(eq(repository.id, association.repositoryId), eq(repository.active, true), eq(repository.installationId, association.installationId),
      eq(repository.connectionEpoch, association.connectionEpoch), eq(githubRepositoryAssociation.ownerId, association.ownerId),
      eq(githubRepositoryAssociation.repositoryNodeId, association.repositoryNodeId),
      notExists(db.select({ id: account.id }).from(account).where(and(link, ne(account.id, linked.id))))));
}

async function authorizeGitHubRepository(headers: Headers, repositoryId: string) {
  const { db, github } = getRuntime();
  if (!github || !/^[1-9]\d{0,15}$/u.test(repositoryId) || !Number.isSafeInteger(Number(repositoryId))) return null;
  const actor = await resolveRepositoryActor(headers);
  if (!actor) return null;

  const [linked, duplicate] = await linkedGitHubAccounts(db, actor.userId);
  if (!linked || duplicate) return null;
  const [association] = await liveAssociations(db, actor.userId, Number(repositoryId));
  if (!association) return null;
  const token = await github.getAccessToken(actor.userId);
  if (token.status !== "ready") return null;
  const resolver = createGitHubLiveAccessResolver({
    getAccessToken: async () => token, verifyCurrentUserAccess: github.repository.verifyCurrentUserAccess,
  });
  const verified = await resolver.resolve({ userId: actor.userId, accountId: linked.accountId, association });
  if (verified.status !== "ready") return null;
  const { role, canConfigure, canWrite, userId, identity } = verified.access;
  return { db, github, actor, linked, association, token: token.accessToken, role, identity, canConfigure: role === "admin" && canConfigure && canWrite,
    expectation: { userId, ownerId: association.ownerId, nodeId: association.repositoryNodeId } };
}

export async function readGitHubSetup(headers: Headers, repositoryId: string): Promise<GitHubSetupReadResult> {
  try {
    const access = await authorizeGitHubRepository(headers, repositoryId);
    if (!access) return { status: "unavailable" };
    const { db, github, actor, linked, association, token, expectation } = access;
    const [before] = await currentGitHubRepository(db, actor, association, linked);
    if (!before) return { status: "unavailable" };
    const result = await github.setup.readSetup(token, association.installationId, association.repositoryId, expectation);
    const [after] = await currentGitHubRepository(db, actor, association, linked);
    if (!after) return { status: "unavailable" };
    return result.status === "ready" ? { ...result, canConfigure: result.canConfigure && access.canConfigure } : result;
  } catch {
    return { status: "unavailable" };
  }
}

export async function openGitHubSetup(headers: Headers, repositoryId: string, expectedSourceRevision: string): Promise<GitHubSetupResult> {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(expectedSourceRevision)) return { status: "unavailable" };
  try {
    const access = await authorizeGitHubRepository(headers, repositoryId);
    if (!access) return { status: "unavailable" };
    const { db, github, actor, linked, association, token, expectation, canConfigure } = access;
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('lock_timeout', '5s', true), set_config('idle_in_transaction_session_timeout', '60s', true)`);
      // Pin linked-account uniqueness and the active user/association throughout the bounded provider mutation.
      await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.userId)).for("update");
      const [current] = await currentGitHubRepository(tx, actor, association, linked).for("share", {
        of: [repository, githubRepositoryAssociation, installation, membership, session, account],
      });
      if (!current) return { status: "unavailable" };
      if (!canConfigure) return { status: "forbidden" };
      return github.setup.openSetup(token, association.installationId, association.repositoryId,
        { ...expectation, sourceRevision: expectedSourceRevision });
    });
  } catch {
    return { status: "unavailable" };
  }
}

export async function readGitHubWorkspace(headers: Headers, repositoryId: string): Promise<GitHubWorkspaceRead | null> {
  try {
    const scope = await authorizeGitHubRepository(headers, repositoryId);
    if (!scope) return null;
    const { db, github, actor, linked, association, role, identity } = scope;
    const [before] = await currentGitHubRepository(db, actor, association, linked);
    if (!before) return null;
    const headRevision = await github.repository.readDefaultRevision(identity, AbortSignal.timeout(20_000));
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(headRevision) || /^0+$/u.test(headRevision)) return null;

    // Fetch content in the same statement that rechecks authorization and the exact association after the provider read.
    const authorized = currentGitHubRepository(db, actor, association, linked).as("authorized_github_repository");
    const [current] = await db.select({
      name: authorized.name, description: authorized.description, head: githubIndexState.headRevision, indexStatus: githubIndexState.status,
      revision: githubSnapshot.revision, snapshot: githubSnapshot.projection, indexedAt: githubSnapshot.indexedAt,
    }).from(authorized).leftJoin(githubIndexState, and(eq(githubIndexState.repositoryId, association.repositoryId),
      eq(githubIndexState.connectionEpoch, association.connectionEpoch)))
      .leftJoin(githubSnapshot, and(eq(githubSnapshot.repositoryId, githubIndexState.repositoryId),
        eq(githubSnapshot.connectionEpoch, githubIndexState.connectionEpoch), eq(githubSnapshot.revision, githubIndexState.indexedRevision),
        eq(githubSnapshot.schemaVersion, githubIndexState.indexedSchemaVersion), eq(githubSnapshot.policyVersion, githubIndexState.indexedPolicyVersion)));
    if (!current) return null;

    const { name, description, head, indexStatus, revision, snapshot, indexedAt } = current;
    let status: GitHubWorkspaceRead["snapshot"]["status"] = revision === null ? "pending" : "stale";
    if (indexStatus === "invalid" && head === headRevision) status = "invalid";
    else if (revision === headRevision) status = "current";
    return {
      repository: { id: repositoryId, name, description, role }, userId: actor.userId,
      snapshot: { status, headRevision, revision, snapshot, indexedAt: indexedAt?.toISOString() ?? null },
    };
  } catch {
    return null;
  }
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
