import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "@nutshell/server/config";
import { acceptFixtureDelivery } from "@nutshell/server/fixture-sync";
import { isGitHubBranch } from "@nutshell/server/github-app";
import { acceptLivePullCheck } from "@nutshell/server/github-live-checks";
import { acceptLiveRevocation, type LiveRevocation } from "@nutshell/server/github-live-revocation";
import { acceptLivePush } from "@nutshell/server/github-live-sync";
import { readBoundedBody } from "../../request-body";

export const runtime = "nodejs";

const maxFixtureBodyBytes = 64 * 1024;
const maxLiveBodyBytes = 1024 * 1024;
const branchPrefix = "refs/heads/";
const liveEvents = new Set(["installation", "installation_repositories", "repository", "github_app_authorization", "pull_request"]);
const pullActions = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
const queueBranchPattern = /^(?:refs\/heads\/)?gh-readonly-queue(?:\/|$)/u;

function outcome(status: string, code: number) {
  return Response.json({ status }, { status: code, headers: { "Cache-Control": "no-store" } });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function readId(value: unknown) {
  if (!value || typeof value !== "object" || !("id" in value)) return null;
  return isPositiveSafeInteger(value.id) ? value.id : null;
}

function isRepositoryNodeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    value.isWellFormed() && !/[\s\p{Cc}]/u.test(value);
}

function isFullRevision(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
}

function isZeroRevision(value: string) {
  return /^0+$/u.test(value);
}

function readPush(value: unknown) {
  if (!value || typeof value !== "object" || !("ref" in value) || !("after" in value) ||
    !("repository" in value) || !("installation" in value)) return null;
  const { ref, after, repository, installation } = value;
  if (typeof ref !== "string" || !ref.startsWith("refs/") || ref.length > 1_024 ||
    !isFullRevision(after)) return null;
  const repositoryId = readId(repository);
  const installationId = readId(installation);
  if (!repositoryId || !installationId) return null;
  const deleted = "deleted" in value ? value.deleted : false;
  if (typeof deleted !== "boolean") return null;
  return { ref, revision: after, repository, repositoryId, installationId, deleted };
}

function readLiveRepository(value: unknown) {
  if (!value || typeof value !== "object" || !("owner" in value) || !("node_id" in value) || !("default_branch" in value)) return null;
  const { owner, node_id: repositoryNodeId, default_branch: defaultBranch } = value;
  const ownerId = readId(owner);
  if (!ownerId || !isRepositoryNodeId(repositoryNodeId) || !isGitHubBranch(defaultBranch)) return null;
  return { ownerId, repositoryNodeId, defaultBranch };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readLivePullCheck(value: unknown): Omit<Parameters<typeof acceptLivePullCheck>[0], "deliveryId"> | "ignored" | "invalid" {
  if (!isObject(value) || typeof value.action !== "string") return "invalid";
  if (!pullActions.has(value.action)) return "ignored";

  const pull = value.pull_request;
  if (!isObject(pull)) return "invalid";
  if (pull.state === "closed") return "ignored";
  if (pull.state !== "open" || !isObject(pull.base) || !isObject(pull.head)) return "invalid";

  const { head, base } = pull;
  const pullNumber = value.number;
  const repositoryId = readId(value.repository);
  const installationId = readId(value.installation);
  const repository = readLiveRepository(value.repository);
  if (!isPositiveSafeInteger(pullNumber) || pull.number !== pullNumber || !repositoryId ||
    readId(base.repo) !== repositoryId || !installationId || !repository) return "invalid";

  if (head.repo === null) return "ignored";
  const headRepositoryId = readId(head.repo);
  const { ref: baseBranch, sha: baseRevision } = base;
  const { ref: headBranch, sha: headRevision } = head;
  if (!headRepositoryId || !isGitHubBranch(baseBranch) || !isGitHubBranch(headBranch)) return "invalid";
  if (headRepositoryId !== repositoryId || baseBranch !== repository.defaultBranch ||
    queueBranchPattern.test(baseBranch) || queueBranchPattern.test(headBranch)) return "ignored";

  if (!isFullRevision(baseRevision) || !isFullRevision(headRevision) ||
    isZeroRevision(baseRevision) || isZeroRevision(headRevision)) return "invalid";
  const { ownerId, repositoryNodeId } = repository;
  return { repositoryId, installationId, ownerId, repositoryNodeId, pullNumber, baseBranch, baseRevision, headRevision };
}

function readLiveRevocation(event: string, value: unknown): LiveRevocation | "ignored" | "invalid" {
  if (!isObject(value) || typeof value.action !== "string") return "invalid";
  const { action, installation, repository, sender, repositories_removed: removed } = value;

  if (event === "github_app_authorization") {
    if (action !== "revoked") return "ignored";
    const githubUserId = readId(sender);
    return githubUserId ? { kind: "account", githubUserId } : "invalid";
  }

  if (event === "repository") {
    if (action !== "deleted" && action !== "transferred" && action !== "publicized") return "ignored";
    if (installation === undefined || installation === null) return "ignored";
    const installationId = readId(installation);
    const repositoryId = readId(repository);
    if (!installationId || !repositoryId || !isObject(repository) || !isRepositoryNodeId(repository.node_id)) return "invalid";
    return { kind: "repository", installationId, repositoryId, repositoryNodeId: repository.node_id };
  }

  if (event === "installation" ? action !== "deleted" && action !== "suspend" : action !== "removed") return "ignored";
  const installationId = readId(installation);
  const ownerId = isObject(installation) ? readId(installation.account) : null;
  if (!installationId || !ownerId) return "invalid";
  if (event === "installation") return { kind: "installation", installationId, ownerId };

  if (!Array.isArray(removed)) return "invalid";
  const repositoryIds = new Set<number>();
  for (const repository of removed) {
    const repositoryId = readId(repository);
    if (!repositoryId) return "invalid";
    repositoryIds.add(repositoryId);
  }
  if (!repositoryIds.size && value.repository_selection !== "selected") return "ignored";
  return { kind: "repository_selection", installationId, ownerId, repositoryIds: [...repositoryIds] };
}

export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return outcome("unavailable", 503);
  }
  const secret = config.mode === "live" ? config.githubApp.webhookSecret : config.webhookSecret;
  if (!secret || (config.mode === "local-alpha" && config.deployment !== "local")) {
    return outcome("unavailable", 404);
  }

  const signature = /^sha256=([a-f0-9]{64})$/u.exec(request.headers.get("x-hub-signature-256") ?? "")?.[1];
  if (!signature) return outcome("unauthorized", 401);

  let payload: Buffer | null;
  try {
    payload = await readBoundedBody(request, config.mode === "live" ? maxLiveBodyBytes : maxFixtureBodyBytes);
  } catch {
    return outcome("invalid", 400);
  }
  if (!payload) return outcome("too_large", 413);
  const digest = createHmac("sha256", secret).update(payload).digest();
  if (!timingSafeEqual(digest, Buffer.from(signature, "hex"))) return outcome("unauthorized", 401);

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery")?.toLowerCase();
  if (!event || !/^[a-z_]{1,64}$/u.test(event) ||
    !deliveryId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(deliveryId)) {
    return outcome("invalid", 400);
  }
  if (event !== "push" && (config.mode !== "live" || !liveEvents.has(event))) return outcome("ignored", 202);

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return outcome("invalid", 400);
  }

  try {
    if (event === "pull_request") {
      const target = readLivePullCheck(body);
      if (target === "ignored") return outcome("ignored", 202);
      if (target === "invalid") return outcome("invalid", 400);
      const status = await acceptLivePullCheck({ deliveryId, ...target });
      return outcome(status, status === "unavailable" ? 404 : 202);
    }

    if (event !== "push") {
      const target = readLiveRevocation(event, body);
      if (target === "ignored") return outcome("ignored", 202);
      if (target === "invalid") return outcome("invalid", 400);
      const status = await acceptLiveRevocation(deliveryId, target);
      return outcome(status, status === "unavailable" ? 404 : 202);
    }

    const push = readPush(body);
    if (!push) return outcome("invalid", 400);
    if (push.deleted || isZeroRevision(push.revision)) return outcome("ignored", 202);

    const { repositoryId, installationId, revision, ref } = push;
    const delivery = { deliveryId, repositoryId, installationId, revision };
    if (config.mode === "live") {
      if (!ref.startsWith(branchPrefix)) return outcome("ignored", 202);
      const repository = readLiveRepository(push.repository);
      if (!repository || !isGitHubBranch(ref.slice(branchPrefix.length))) return outcome("invalid", 400);
      if (ref !== branchPrefix + repository.defaultBranch) return outcome("ignored", 202);
      const status = await acceptLivePush({ ...delivery, ownerId: repository.ownerId, repositoryNodeId: repository.repositoryNodeId, ref });
      return outcome(status, status === "unavailable" ? 404 : 202);
    }
    if (ref !== branchPrefix + "main") return outcome("ignored", 202);
    const status = await acceptFixtureDelivery(delivery);
    return outcome(status, status === "unavailable" ? 404 : 202);
  } catch {
    return outcome("unavailable", 503);
  }
}
