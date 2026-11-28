import { createHash } from "node:crypto";
import { repositoryChangePolicyVersion } from "@nutshell/core/change-validation";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { GitHubRepositoryError, isGitHubBranch } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { createGitHubAppValidation } from "./github-app-validation.ts";
import { activeLiveConnection, lockLivePublication, readLiveAcceptedChanges } from "./github-live-sync.ts";
import { getLiveSyncRuntime, type RepositoryTransaction } from "./runtime.ts";
import { githubPullCheckDelivery } from "./schema.ts";

const safeId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u).refine((value) => !/^0+$/u.test(value));
const inputShape = z.object({
  deliveryId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u),
  repositoryId: safeId, installationId: safeId, ownerId: safeId, pullNumber: safeId,
  repositoryNodeId: z.string().min(1).max(256).refine((value) => value.isWellFormed() && !/[\s\p{Cc}]/u.test(value)),
  baseBranch: z.string().refine(isGitHubBranch), baseRevision: sha, headRevision: sha,
}).strict();

type PullInput = z.infer<typeof inputShape>;
type Receipt = typeof githubPullCheckDelivery.$inferSelect;
type Provider = ReturnType<typeof getLiveSyncRuntime>["provider"];
const maxAttempts = 5;

function matchesReceipt(receipt: Receipt, pull: PullInput): boolean {
  return receipt.repositoryId === pull.repositoryId && receipt.installationId === pull.installationId &&
    receipt.ownerId === pull.ownerId && receipt.repositoryNodeId === pull.repositoryNodeId && receipt.pullNumber === pull.pullNumber &&
    receipt.baseBranch === pull.baseBranch && receipt.baseRevision === pull.baseRevision && receipt.headRevision === pull.headRevision;
}

export async function acceptLivePullCheck(input: PullInput): Promise<"accepted" | "duplicate" | "unavailable"> {
  const parsed = inputShape.safeParse(input);
  if (!parsed.success) return "unavailable";
  const pull = parsed.data;
  const { db } = getLiveSyncRuntime();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '2s', true)`);
    const receipt = () => tx.select().from(githubPullCheckDelivery).where(eq(githubPullCheckDelivery.id, pull.deliveryId));
    const [previous] = await receipt();
    if (previous) return matchesReceipt(previous, pull) ? "duplicate" : "unavailable";
    const [connection] = await activeLiveConnection(tx, pull);
    if (!connection) return "unavailable";
    const { deliveryId: id, ...scope } = pull;
    const [stored] = await tx.insert(githubPullCheckDelivery).values({
      ...scope, id, connectionEpoch: connection.epoch, policyVersion: repositoryChangePolicyVersion,
    }).onConflictDoNothing().returning({ id: githubPullCheckDelivery.id });
    if (stored) return "accepted";
    const [concurrent] = await receipt();
    return concurrent && matchesReceipt(concurrent, pull) ? "duplicate" : "unavailable";
  });
}

const obsolete = { status: "obsolete", failureCode: null } as const;

async function publishCheck(tx: RepositoryTransaction, provider: Provider, job: Receipt, signal: AbortSignal) {
  const [active] = await activeLiveConnection(tx, job);
  if (active?.epoch !== job.connectionEpoch || job.policyVersion !== repositoryChangePolicyVersion) return obsolete;
  const identity = await provider.verifyInstalledRepository(job, signal);
  if (!identity || identity.defaultBranch !== job.baseBranch) return obsolete;
  const accepted = await readLiveAcceptedChanges(tx, job.repositoryId, job.connectionEpoch);
  const { checkInput } = await createGitHubAppValidation(provider).preparePullRequestCheck(identity, {
    pullNumber: job.pullNumber, expectedBase: job.baseRevision, expectedHead: job.headRevision,
  }, accepted.size ? accepted : undefined, signal);

  signal.throwIfAborted();
  if (!await lockLivePublication(tx, job)) return obsolete;
  signal.throwIfAborted();
  // Different deliveries of the same exact scoped comparison have the same provider retry identity.
  const signature = [job.repositoryId, job.installationId, job.ownerId, job.repositoryNodeId, job.connectionEpoch,
    job.pullNumber, job.baseBranch, job.baseRevision, job.headRevision, job.policyVersion];
  const externalId = "nutshell-" + createHash("sha256").update(JSON.stringify(signature)).digest("hex");
  const check = await provider.publishPullRequestCheck(identity, { ...checkInput, externalId }, signal);
  if (check.head !== job.headRevision || check.conclusion !== checkInput.conclusion || check.status !== "completed") {
    throw new GitHubRepositoryError("invalid_response", "GitHub returned a Check outside the exact work receipt.");
  }
  return { status: "published", checkRunId: check.id, conclusion: check.conclusion, failureCode: null } as const;
}

export async function processNextLivePullCheck(shutdown?: AbortSignal): Promise<boolean> {
  if (shutdown?.aborted) return false;
  const { db, provider } = getLiveSyncRuntime();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', '5s', true), set_config('idle_in_transaction_session_timeout', '85s', true)`);
    const [job] = await tx.select().from(githubPullCheckDelivery)
      .where(and(eq(githubPullCheckDelivery.status, "queued"), lte(githubPullCheckDelivery.availableAt, sql`now()`)))
      .orderBy(githubPullCheckDelivery.receivedAt, githubPullCheckDelivery.id).limit(1).for("update", { skipLocked: true });
    if (!job || shutdown?.aborted) return false;
    const timeout = AbortSignal.timeout(65_000);
    const signal = shutdown ? AbortSignal.any([timeout, shutdown]) : timeout;
    const attempts = job.attempts + 1;
    const target = eq(githubPullCheckDelivery.id, job.id);
    try {
      await tx.transaction(async (work) => {
        const result = await publishCheck(work, provider, job, signal);
        signal.throwIfAborted();
        await work.update(githubPullCheckDelivery).set({ ...result, attempts, processedAt: sql`clock_timestamp()` }).where(target);
      });
    } catch (error) {
      if (shutdown?.aborted) return false;
      if (error instanceof GitHubRepositoryError && (error.code === "conflict" || error.code === "unsupported")) {
        await tx.update(githubPullCheckDelivery).set({ ...obsolete, attempts, processedAt: sql`clock_timestamp()` }).where(target);
        return true;
      }
      const retry = attempts < maxAttempts;
      const backoff = Math.min(300, Math.max(2 ** attempts, error instanceof GitHubTransportError ? error.retryAfterSeconds ?? 0 : 0));
      await tx.update(githubPullCheckDelivery).set({ status: retry ? "queued" : "failed", failureCode: "check_error", attempts,
        availableAt: sql`clock_timestamp() + (${backoff} * interval '1 second')`, processedAt: retry ? null : sql`clock_timestamp()`,
      }).where(target);
    }
    return true;
  });
}
