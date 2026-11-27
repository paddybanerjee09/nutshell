import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { loadConfig } from "./config.ts";
import { personas } from "./local-fixtures.ts";
import { account, installation, membership, providerGrant, repository, session, user, verification } from "./schema.ts";

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
  const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    baseURL: config.origin,
    secret: config.authSecret,
    trustedOrigins: [config.origin],
    advanced: {
      useSecureCookies: config.origin.startsWith("https:"),
      disableOriginCheck: false,
      disableCSRFCheck: false,
    },
    session: { cookieCache: { enabled: false } },
    plugins: [localPersonaPlugin(config.origin)],
  });
  return { db, auth, pool };
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

export type Repository = { id: string; name: string; description: string };

async function authorizedRepositories(userId: string, id?: number): Promise<Repository[]> {
  const rows = await getRuntime().db.select({
    id: repository.id, name: repository.name, description: repository.description,
  }).from(repository).innerJoin(installation, and(
    eq(installation.id, repository.installationId), eq(installation.active, true),
  )).innerJoin(membership, and(
    eq(membership.repositoryId, repository.id), eq(membership.userId, userId), eq(membership.active, true),
  )).innerJoin(providerGrant, and(
    eq(providerGrant.repositoryId, repository.id), eq(providerGrant.userId, userId), eq(providerGrant.canRead, true),
  )).where(and(eq(repository.active, true), id === undefined ? undefined : eq(repository.id, id)))
    .orderBy(asc(repository.name), asc(repository.id));

  return rows.map((row) => ({ ...row, id: String(row.id) }));
}

export async function listRepositories(headers: Headers): Promise<Repository[] | null> {
  const auth = await getSession(headers);
  return auth ? authorizedRepositories(auth.user.id) : null;
}

export async function readRepository(headers: Headers, id: string): Promise<Repository | null> {
  const numericId = Number(id);
  if (!/^[1-9]\d{0,15}$/u.test(id) || !Number.isSafeInteger(numericId)) return null;
  const auth = await getSession(headers);
  if (!auth) return null;
  const [result] = await authorizedRepositories(auth.user.id, numericId);
  return result ?? null;
}
