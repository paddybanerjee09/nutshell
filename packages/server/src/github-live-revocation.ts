import { createHash } from "node:crypto";
import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getLiveSyncRuntime, type RepositoryTransaction } from "./runtime.ts";
import { account, githubRepositoryAssociation, githubRevocationDelivery, installation, repository, session, user } from "./schema.ts";

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const installScope = { installationId: safeId, ownerId: safeId };
const stableNodeId = z.string().min(1).max(256).refine((value) => value.isWellFormed() && !/[\s\p{Cc}]/u.test(value));
const revocation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("installation"), ...installScope }).strict(),
  z.object({ kind: z.literal("repository_selection"), ...installScope, repositoryIds: z.array(safeId) }).strict(),
  z.object({ kind: z.literal("repository"), installationId: safeId, repositoryId: safeId, repositoryNodeId: stableNodeId }).strict(),
  z.object({ kind: z.literal("account"), githubUserId: safeId }).strict(),
]);
const deliveryPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;

export type LiveRevocation = z.infer<typeof revocation>;

async function removeGitHubAccountAccess(tx: RepositoryTransaction, githubUserId: number) {
  const binding = and(eq(account.providerId, "github"), eq(account.accountId, String(githubUserId)));
  // Keep the user row lock order used by live repository writes and account linking.
  const linked = await tx.select({ id: user.id }).from(user).where(exists(tx.select({ id: account.id })
    .from(account).where(and(binding, eq(account.userId, user.id))))).orderBy(asc(user.id)).for("update");
  if (!linked.length) return;
  const userIds = linked.map(({ id }) => id);
  const revoked = await tx.update(account).set({ accessToken: null, refreshToken: null, idToken: null,
    accessTokenExpiresAt: null, refreshTokenExpiresAt: null, scope: null, updatedAt: sql`clock_timestamp()`,
  }).where(and(binding, inArray(account.userId, userIds))).returning({ userId: account.userId });
  const revokedUserIds = [...new Set(revoked.map(({ userId }) => userId))];
  if (revokedUserIds.length) await tx.delete(session).where(inArray(session.userId, revokedUserIds));
}

async function removeRepositoryAccess(tx: RepositoryTransaction, target: Exclude<LiveRevocation, { kind: "account" }>) {
  // A selection change can omit the affected repositories. Its receipt cannot identify any particular removal.
  if (target.kind === "repository_selection" && !target.repositoryIds.length) return;
  // Serialize with current-ref publication and reconciliation, including deactivation of a whole installation.
  const [installed] = await tx.select({ id: installation.id }).from(installation).where(eq(installation.id, target.installationId))
    .for(target.kind === "installation" ? "update" : "share");
  if (!installed) return;
  const matchesInstallation = eq(repository.installationId, installed.id);
  const associationScope = target.kind === "repository" ? eq(githubRepositoryAssociation.repositoryNodeId, target.repositoryNodeId)
    : eq(githubRepositoryAssociation.ownerId, target.ownerId);
  const stableAssociation = exists(tx.select({ id: githubRepositoryAssociation.repositoryId }).from(githubRepositoryAssociation)
    .where(and(eq(githubRepositoryAssociation.repositoryId, repository.id), associationScope)));

  if (target.kind === "installation") {
    const [sameOwner] = await tx.select({ id: repository.id }).from(repository).where(and(matchesInstallation, stableAssociation)).limit(1);
    if (!sameOwner) return;
    // The installation trigger advances every attached epoch and the inactive installation denies access.
    await tx.update(installation).set({ active: false }).where(and(eq(installation.id, installed.id), eq(installation.active, true)));
    return;
  }
  const selected = target.kind === "repository" ? eq(repository.id, target.repositoryId)
    // A signed list is already byte-bounded. One numeric array parameter also handles large selections.
    : sql`${repository.id} = ANY(${`{${target.repositoryIds.join(",")}}`}::bigint[])`;
  // The repository trigger advances the epoch when an individually selected association is deactivated.
  await tx.update(repository).set({ active: false })
    .where(and(eq(repository.active, true), matchesInstallation, stableAssociation, selected));
}

export async function acceptLiveRevocation(deliveryId: string, target: LiveRevocation): Promise<"accepted" | "duplicate" | "unavailable"> {
  const parsed = revocation.safeParse(target);
  if (!deliveryPattern.test(deliveryId) || !parsed.success) return "unavailable";
  const scope = parsed.data.kind === "repository_selection" ? {
    ...parsed.data, repositoryIds: [...new Set(parsed.data.repositoryIds)].sort((left, right) => left - right),
  } : parsed.data;
  const scopeDigest = createHash("sha256").update(JSON.stringify(scope)).digest("hex");

  return getLiveSyncRuntime().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '4s', true), set_config('statement_timeout', '5s', true)`);
    const [receipt] = await tx.insert(githubRevocationDelivery).values({ id: deliveryId, kind: scope.kind, scopeDigest })
      .onConflictDoNothing().returning({ id: githubRevocationDelivery.id });
    if (!receipt) {
      const [previous] = await tx.select({ digest: githubRevocationDelivery.scopeDigest }).from(githubRevocationDelivery)
        .where(eq(githubRevocationDelivery.id, deliveryId));
      return previous?.digest === scopeDigest ? "duplicate" : "unavailable";
    }
    if (scope.kind === "account") await removeGitHubAccountAccess(tx, scope.githubUserId);
    else await removeRepositoryAccess(tx, scope);
    return "accepted";
  });
}
