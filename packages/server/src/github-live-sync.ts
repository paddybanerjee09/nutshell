import { randomUUID } from "node:crypto";
import { projectRepositoryTree } from "@nutshell/core/snapshot";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { GitHubRepositoryError, isGitHubBranch, type GitHubInstalledRepositoryScope, type GitHubRepositoryIdentity } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { getLiveSyncRuntime, withGitHubIndexAdmin, type RepositoryTransaction } from "./runtime.ts";
import { githubAcceptedChange, githubIndexState, githubPushDelivery, githubRepositoryAssociation, githubSnapshot, installation, repository } from "./schema.ts";

const schemaVersion = 1;
const policyVersion = 1;
const maxAttempts = 5;
const maxAttemptTime = 45_000;
const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pushSchema = z.object({
  deliveryId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u),
  repositoryId: safeId,
  installationId: safeId,
  ownerId: safeId,
  repositoryNodeId: z.string().min(1).max(256).refine((value) => value.isWellFormed() && !/[\s\p{Cc}]/u.test(value)),
  ref: z.string().startsWith("refs/heads/").refine((value) => isGitHubBranch(value.slice("refs/heads/".length))),
  revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).refine((value) => !/^0+$/u.test(value)),
}).strict();

type LivePush = z.infer<typeof pushSchema>;
type PushReceipt = typeof githubPushDelivery.$inferSelect;
type LiveIndexProvider = Pick<ReturnType<typeof getLiveSyncRuntime>["provider"], "verifyInstalledRepository" | "readDefaultRevision" | "readImmutableTree">;

function activeConnection(tx: RepositoryTransaction, input: GitHubInstalledRepositoryScope) {
  return tx.select({ epoch: repository.connectionEpoch }).from(repository)
    .innerJoin(installation, and(eq(installation.id, repository.installationId), eq(installation.active, true)))
    .innerJoin(githubRepositoryAssociation, eq(githubRepositoryAssociation.repositoryId, repository.id))
    .where(and(eq(repository.id, input.repositoryId), eq(repository.active, true), eq(repository.installationId, input.installationId),
      eq(githubRepositoryAssociation.ownerId, input.ownerId), eq(githubRepositoryAssociation.repositoryNodeId, input.repositoryNodeId)));
}

function matchesPush(receipt: PushReceipt, push: LivePush): boolean {
  return receipt.source === "webhook" && receipt.repositoryId === push.repositoryId && receipt.installationId === push.installationId &&
    receipt.ownerId === push.ownerId && receipt.repositoryNodeId === push.repositoryNodeId && receipt.ref === push.ref && receipt.revision === push.revision;
}

export type GitHubIndexRequestResult = { status: "queued" | "current"; revision: string } | { status: "forbidden" | "unavailable" };

export async function requestGitHubReconciliation(headers: Headers, repositoryId: string): Promise<GitHubIndexRequestResult> {
  return withGitHubIndexAdmin(headers, repositoryId, async ({ tx, ...scope }): Promise<GitHubIndexRequestResult> => {
    const { connectionEpoch, ref, revision } = scope;
    const [current] = await tx.select({ revision: githubIndexState.indexedRevision }).from(githubIndexState).where(and(
      eq(githubIndexState.repositoryId, scope.repositoryId), eq(githubIndexState.connectionEpoch, connectionEpoch),
      eq(githubIndexState.status, "current"), eq(githubIndexState.indexedRevision, revision),
      eq(githubIndexState.indexedSchemaVersion, schemaVersion), eq(githubIndexState.indexedPolicyVersion, policyVersion),
    ));
    if (current) return { status: "current", revision };

    const queued = () => tx.select({ id: githubPushDelivery.id }).from(githubPushDelivery).where(and(
      eq(githubPushDelivery.repositoryId, scope.repositoryId), eq(githubPushDelivery.connectionEpoch, connectionEpoch),
      eq(githubPushDelivery.installationId, scope.installationId), eq(githubPushDelivery.ownerId, scope.ownerId),
      eq(githubPushDelivery.repositoryNodeId, scope.repositoryNodeId),
      eq(githubPushDelivery.ref, ref), eq(githubPushDelivery.revision, revision), eq(githubPushDelivery.status, "queued"),
      eq(githubPushDelivery.schemaVersion, schemaVersion), eq(githubPushDelivery.policyVersion, policyVersion),
    )).limit(1);
    if (!(await queued()).length) {
      const [work] = await tx.insert(githubPushDelivery).values({ ...scope, id: randomUUID(), source: "reconcile", schemaVersion, policyVersion })
        .onConflictDoNothing().returning({ id: githubPushDelivery.id });
      if (!work && !(await queued()).length) return { status: "unavailable" };
    }
    return { status: "queued", revision };
  });
}

export async function acceptLivePush(input: LivePush): Promise<"accepted" | "duplicate" | "unavailable"> {
  const parsed = pushSchema.safeParse(input);
  if (!parsed.success) return "unavailable";
  const push = parsed.data;
  const { db } = getLiveSyncRuntime();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '2s', true)`);
    const receipt = () => tx.select().from(githubPushDelivery).where(eq(githubPushDelivery.id, push.deliveryId));
    const [previous] = await receipt();
    if (previous) return matchesPush(previous, push) ? "duplicate" : "unavailable";
    const [connection] = await activeConnection(tx, push);
    if (!connection) return "unavailable";
    const { deliveryId: id, ...scope } = push;
    const [stored] = await tx.insert(githubPushDelivery).values({
      ...scope, id, connectionEpoch: connection.epoch, schemaVersion, policyVersion,
    }).onConflictDoNothing().returning({ id: githubPushDelivery.id });
    if (stored) return "accepted";
    const [concurrent] = await receipt();
    return concurrent && matchesPush(concurrent, push) ? "duplicate" : "unavailable";
  });
}

const obsolete = { status: "obsolete", failureCode: null } as const;

async function currentDefault(provider: LiveIndexProvider, job: PushReceipt, signal: AbortSignal): Promise<GitHubRepositoryIdentity | null> {
  const identity = await provider.verifyInstalledRepository(job, signal);
  if (!identity || `refs/heads/${identity.defaultBranch}` !== job.ref) return null;
  return await provider.readDefaultRevision(identity, signal) === job.revision ? identity : null;
}

async function lockPublication(tx: RepositoryTransaction, job: PushReceipt) {
  // Match the installation-first lock order used by the connection lifecycle.
  const [active] = await tx.select({ id: installation.id }).from(installation)
    .where(and(eq(installation.id, job.installationId), eq(installation.active, true))).for("share");
  if (!active) return false;
  const [connection] = await activeConnection(tx, job).for("no key update", { of: [repository, githubRepositoryAssociation] });
  return connection?.epoch === job.connectionEpoch;
}

async function indexPush(tx: RepositoryTransaction, provider: LiveIndexProvider, job: PushReceipt, signal: AbortSignal) {
  const { repositoryId, connectionEpoch, revision } = job;
  const [active] = await activeConnection(tx, job);
  if (active?.epoch !== connectionEpoch || job.schemaVersion !== schemaVersion || job.policyVersion !== policyVersion) return obsolete;
  const identity = await currentDefault(provider, job, signal);
  if (!identity) return obsolete;

  let immutable: Awaited<ReturnType<LiveIndexProvider["readImmutableTree"]>> | undefined;
  try {
    immutable = await provider.readImmutableTree(identity, revision, signal);
  } catch (error) {
    if (!(error instanceof GitHubRepositoryError) || !["unsupported", "limit"].includes(error.code)) throw error;
  }

  signal.throwIfAborted();
  if (!await lockPublication(tx, job)) return obsolete;

  const scope = { repositoryId, connectionEpoch };
  const [state] = await tx.select({ revision: githubIndexState.indexedRevision }).from(githubIndexState)
    .where(and(eq(githubIndexState.repositoryId, repositoryId), eq(githubIndexState.connectionEpoch, connectionEpoch)));
  const rows = await tx.select({ id: githubAcceptedChange.id, payload: githubAcceptedChange.payload }).from(githubAcceptedChange)
    .where(and(eq(githubAcceptedChange.repositoryId, repositoryId), eq(githubAcceptedChange.connectionEpoch, connectionEpoch)));
  const acceptedChanges = new Map(rows.map(({ id, payload }) => [id, payload]));
  const projection = immutable && projectRepositoryTree(new Map(immutable.files.map(({ path, body }) => [path, body])),
    state?.revision ? { acceptedChanges } : undefined);
  // Hold the repository/association lock while checking the default ref immediately before publication.
  if (!await currentDefault(provider, job, signal)) return obsolete;
  signal.throwIfAborted();
  const target = [githubIndexState.repositoryId, githubIndexState.connectionEpoch];
  if (!projection?.ok) {
    await tx.insert(githubIndexState).values({ ...scope, headRevision: revision, status: "invalid" })
      .onConflictDoUpdate({ target, set: { headRevision: revision, status: "invalid" } });
    const breaksHistory = projection?.issues.some(({ code }) => code === "change-removed" || code === "change-rewritten");
    return { status: "invalid", failureCode: breaksHistory ? "invalid_history" : "invalid_tree" } as const;
  }

  const introduced = projection.snapshot.changes.filter(({ id }) => !acceptedChanges.has(id));
  if (introduced.length) await tx.insert(githubAcceptedChange).values(introduced.map((payload) => ({
    ...scope, id: payload.id, sourceRevision: revision, payload, observedAt: sql`clock_timestamp()`,
  })));
  await tx.insert(githubSnapshot).values({ ...scope, revision, schemaVersion, policyVersion,
    projection: projection.snapshot, indexedAt: sql`clock_timestamp()` }).onConflictDoNothing();
  const indexed = { headRevision: revision, status: "current" as const, indexedRevision: revision,
    indexedSchemaVersion: schemaVersion, indexedPolicyVersion: policyVersion };
  await tx.insert(githubIndexState).values({ ...scope, ...indexed }).onConflictDoUpdate({ target, set: indexed });
  return { status: "published", failureCode: null } as const;
}

export async function checkLiveSyncDatabase() {
  await getLiveSyncRuntime().db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true)`);
    await tx.select({ id: githubPushDelivery.id }).from(githubPushDelivery).limit(1);
  });
}

export async function processNextLivePush(shutdown?: AbortSignal): Promise<boolean> {
  if (shutdown?.aborted) return false;
  const { db, provider } = getLiveSyncRuntime();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true), set_config('idle_in_transaction_session_timeout', '65s', true)`);
    const [job] = await tx.select().from(githubPushDelivery)
      .where(and(eq(githubPushDelivery.status, "queued"), lte(githubPushDelivery.availableAt, sql`now()`)))
      .orderBy(githubPushDelivery.receivedAt, githubPushDelivery.id).limit(1).for("update", { skipLocked: true });
    if (!job || shutdown?.aborted) return false;
    const timeout = AbortSignal.timeout(maxAttemptTime);
    const signal = shutdown ? AbortSignal.any([timeout, shutdown]) : timeout;
    const attempts = job.attempts + 1;
    try {
      await tx.transaction(async (work) => {
        const result = await indexPush(work, provider, job, signal);
        signal.throwIfAborted();
        await work.update(githubPushDelivery).set({ ...result, attempts, processedAt: sql`clock_timestamp()` }).where(eq(githubPushDelivery.id, job.id));
      });
    } catch (error) {
      if (shutdown?.aborted) return false;
      if (error instanceof GitHubRepositoryError && error.code === "conflict") {
        await tx.update(githubPushDelivery).set({ ...obsolete, attempts, processedAt: sql`clock_timestamp()` }).where(eq(githubPushDelivery.id, job.id));
        return true;
      }
      const retry = attempts < maxAttempts;
      const backoff = Math.min(300, Math.max(2 ** attempts, error instanceof GitHubTransportError ? error.retryAfterSeconds ?? 0 : 0));
      await tx.update(githubPushDelivery).set({ status: retry ? "queued" : "failed", failureCode: "indexing_error", attempts,
        availableAt: sql`clock_timestamp() + (${backoff} * interval '1 second')`, processedAt: retry ? null : sql`clock_timestamp()`,
      }).where(eq(githubPushDelivery.id, job.id));
    }
    return true;
  });
}
