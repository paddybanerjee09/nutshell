import { and, eq, gt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { validGitHubAppToken } from "./github-app-auth.ts";
import type { GitHubAppUserTokenResult } from "./github-app-auth-tokens.ts";
import type { GitHubAppRepository, GitHubRepositoryAccess } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { account, githubRepositoryAssociation, installation, membership, repository, session, user } from "./schema.ts";

type Actor = { userId: string; sessionId: string };
type LinkedAccount = { id: string; accountId: string };
type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
type GitHub = {
  getAccessToken: (userId: string) => Promise<GitHubAppUserTokenResult>;
  repository: Pick<GitHubAppRepository, "discoverConnections" | "verifyCurrentUserAccess">;
};
type Discovery = Awaited<ReturnType<GitHub["repository"]["discoverConnections"]>>;
type Unavailable = { status: "unavailable" | "reauthorize" };
type ConnectFailure = Unavailable | { status: "denied" | "conflict" };
export type GitHubConnectionsResult = { status: "ready" } & Pick<Discovery, "installationUrl" | "candidates"> | Unavailable;
export type ConnectGitHubRepositoryInput = { repositoryId: number; installationId: number };
export type ConnectGitHubRepositoryResult = { status: "connected"; repositoryId: string } | ConnectFailure;

class ConnectionConflict extends Error {}

function positiveId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function linkedGitHubAccounts(db: Pick<NodePgDatabase, "select">, userId: string) {
  return db.select({ id: account.id, accountId: account.accountId }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "github"))).limit(2);
}

async function confirmActor(tx: Transaction, actor: Actor, prior: LinkedAccount): Promise<"ready" | Unavailable["status"]> {
  // Lock in parent-before-child order. An OAuth link cannot insert another account for this user while committing.
  const [person] = await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.userId)).for("update");
  if (!person) return "unavailable";
  const [signedIn] = await tx.select({ id: session.id }).from(session)
    .where(and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId), gt(session.expiresAt, sql`clock_timestamp()`)))
    .for("share");
  if (!signedIn) return "unavailable";

  const [linked, duplicate] = await linkedGitHubAccounts(tx, actor.userId).for("share");
  return linked?.id === prior.id && linked.accountId === prior.accountId && !duplicate ? "ready" : "reauthorize";
}

function providerFailure(error: unknown): ConnectFailure["status"] {
  if (error instanceof ConnectionConflict) return "conflict";
  if (error instanceof GitHubTransportError) {
    if (error.code === "unauthenticated") return "reauthorize";
    if (error.code === "forbidden" || error.code === "not_found") return "denied";
  }
  return "unavailable";
}

async function persistConnection(tx: Transaction, access: GitHubRepositoryAccess, actor: Actor, previousEpoch: number | undefined): Promise<ConnectGitHubRepositoryResult> {
  const { id: repositoryId, installationId, ownerId, nodeId, owner, name } = access.identity;
  const lease = await tx.execute<{ locked: boolean }>(sql`select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(${`nutshell/live-connection/${repositoryId}`}, 0)) as locked`);
  if (lease.rows[0]?.locked !== true) return { status: "conflict" };

  const [appInstallation] = await tx.select({ active: installation.active }).from(installation)
    .where(eq(installation.id, installationId)).for("update");
  const [stored] = await tx.select({ active: repository.active, installationId: repository.installationId, epoch: repository.connectionEpoch })
    .from(repository).where(eq(repository.id, repositoryId)).for("update");
  if ((previousEpoch !== undefined && stored?.epoch !== previousEpoch) || appInstallation?.active === false) return { status: "conflict" };

  if (stored) {
    const [association] = await tx.select({ ownerId: githubRepositoryAssociation.ownerId, nodeId: githubRepositoryAssociation.repositoryNodeId })
      .from(githubRepositoryAssociation).where(eq(githubRepositoryAssociation.repositoryId, repositoryId)).for("share");
    if (!stored.active || !appInstallation?.active || stored.installationId !== installationId ||
        association?.ownerId !== ownerId || association.nodeId !== nodeId) return { status: "conflict" };
  } else {
    if (access.role !== "admin" || !access.canConfigure) return { status: "denied" };
    if (!appInstallation) {
      const [created] = await tx.insert(installation).values({ id: installationId }).onConflictDoNothing().returning({ id: installation.id });
      if (!created) {
        const [current] = await tx.select({ active: installation.active }).from(installation)
          .where(eq(installation.id, installationId)).for("update");
        if (!current?.active) return { status: "conflict" };
      }
    }
    const [created] = await tx.insert(repository).values({ id: repositoryId, installationId, name: `${owner}/${name}`, description: "" })
      .onConflictDoNothing().returning({ id: repository.id });
    if (!created) throw new ConnectionConflict();
    const [associated] = await tx.insert(githubRepositoryAssociation).values({ repositoryId, ownerId, repositoryNodeId: nodeId })
      .onConflictDoNothing().returning({ id: githubRepositoryAssociation.repositoryId });
    // Roll back a newly inserted installation/repository if another repository already has this node ID.
    if (!associated) throw new ConnectionConflict();
  }

  const member = and(eq(membership.userId, actor.userId), eq(membership.repositoryId, repositoryId));
  const [existingMember] = await tx.select({ active: membership.active }).from(membership).where(member).for("update");
  if (existingMember?.active === false) return { status: "denied" };
  if (!existingMember) {
    const [added] = await tx.insert(membership).values({ userId: actor.userId, repositoryId }).onConflictDoNothing()
      .returning({ id: membership.repositoryId });
    if (!added) throw new ConnectionConflict();
  }
  return { status: "connected", repositoryId: String(repositoryId) };
}

export function createGitHubLiveOnboarding(db: NodePgDatabase, github: GitHub) {
  async function credentials(actor: Actor) {
    const [linked, duplicate] = await linkedGitHubAccounts(db, actor.userId);
    if (!linked || duplicate || !/^[1-9]\d{0,15}$/u.test(linked.accountId) || !positiveId(Number(linked.accountId))) {
      return { status: "reauthorize" } as const;
    }
    const token = await github.getAccessToken(actor.userId);
    if (token.status !== "ready") return { status: token.status };
    if (token.accountId !== linked.accountId || !validGitHubAppToken(token.accessToken, "access")) return { status: "reauthorize" } as const;
    return { status: "ready", linked, token: token.accessToken } as const;
  }

  function withCurrentActor<Result>(actor: Actor, linked: LinkedAccount, proceed: (tx: Transaction) => Promise<Result>): Promise<Result | Unavailable> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      const status = await confirmActor(tx, actor, linked);
      return status === "ready" ? proceed(tx) : { status };
    });
  }

  return {
    async list(actor: Actor): Promise<GitHubConnectionsResult> {
      try {
        const identity = await credentials(actor);
        if (identity.status !== "ready") return identity;
        const { userId, installationUrl, candidates } = await github.repository.discoverConnections(identity.token);
        if (String(userId) !== identity.linked.accountId) return { status: "reauthorize" };
        return await withCurrentActor(actor, identity.linked, async () => ({ status: "ready", installationUrl, candidates } as const));
      } catch (error) {
        return { status: providerFailure(error) === "reauthorize" ? "reauthorize" : "unavailable" };
      }
    },

    async connect(actor: Actor, { repositoryId, installationId }: ConnectGitHubRepositoryInput): Promise<ConnectGitHubRepositoryResult> {
      if (!positiveId(repositoryId) || !positiveId(installationId)) return { status: "denied" };
      try {
        const identity = await credentials(actor);
        if (identity.status !== "ready") return identity;
        const [previous] = await db.select({ epoch: repository.connectionEpoch }).from(repository).where(eq(repository.id, repositoryId));
        const access = await github.repository.verifyCurrentUserAccess(identity.token, installationId, repositoryId);
        if (!access || access.canRead !== true || String(access.userId) !== identity.linked.accountId ||
            access.identity.id !== repositoryId || access.identity.installationId !== installationId) return { status: "denied" };
        return await withCurrentActor(actor, identity.linked, (tx) => persistConnection(tx, access, actor, previous?.epoch));
      } catch (error) {
        return { status: providerFailure(error) };
      }
    },
  };
}
