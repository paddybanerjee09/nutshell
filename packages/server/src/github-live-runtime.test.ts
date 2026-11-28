import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { buildRepositorySetupTree } from "@nutshell/core/fixture-setup-tree";
import { symmetricEncrypt } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { expect, test, vi } from "vitest";
import { loadConfig, requireLocalDatabaseUrl } from "./config.ts";
import * as githubApp from "./github-app.ts";
import type { GitHubRepositoryAccess } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { acceptLivePullCheck, processNextLivePullCheck } from "./github-live-checks.ts";
import { createGitHubLiveOnboarding } from "./github-live-onboarding.ts";
import { acceptLiveRevocation } from "./github-live-revocation.ts";
import { acceptLivePush, checkLiveSyncDatabase, processNextLivePush, requestGitHubReconciliation } from "./github-live-sync.ts";
import {
  closeRuntime, connectGitHubRepository, getAuth, getSession, listGitHubConnections, listRepositories, openGitHubSetup, readGitHubSetup,
  readGitHubWorkspace,
} from "./runtime.ts";
import { account, session, user } from "./schema.ts";
import { migrateLiveDatabase } from "./setup.ts";

const connection = { repositoryId: 523611, installationId: 428191 };
const identity = { id: connection.repositoryId, installationId: connection.installationId, ownerId: 95433,
  nodeId: "R_ephemeral_controlled", owner: "sample-owner", name: "sample-private-repo", defaultBranch: "trunk" };
const sourceRevision = "a".repeat(40);
type GitHubAdapter = ReturnType<typeof githubApp.createGitHubAppAdapter>;

function controlledRuntimeAdapter() {
  const readSetup = vi.fn<GitHubAdapter["setup"]["readSetup"]>();
  const openSetup = vi.fn<GitHubAdapter["setup"]["openSetup"]>();
  const verifyCurrentUserAccess = vi.fn<GitHubAdapter["repository"]["verifyCurrentUserAccess"]>();
  const verifyInstalledRepository = vi.fn<GitHubAdapter["repository"]["verifyInstalledRepository"]>();
  const readDefaultRevision = vi.fn<GitHubAdapter["repository"]["readDefaultRevision"]>();
  const readImmutableTree = vi.fn<GitHubAdapter["repository"]["readImmutableTree"]>();
  const readPullRequestComparison = vi.fn<GitHubAdapter["repository"]["readPullRequestComparison"]>();
  const publishPullRequestCheck = vi.fn<GitHubAdapter["repository"]["publishPullRequestCheck"]>();
  const original = githubApp.createGitHubAppAdapter;
  vi.spyOn(githubApp, "createGitHubAppAdapter").mockImplementation((...args) => {
    const adapter = original(...args);
    return { ...adapter, setup: { ...adapter.setup, readSetup, openSetup },
      repository: { ...adapter.repository, verifyCurrentUserAccess, verifyInstalledRepository, readDefaultRevision, readImmutableTree,
        readPullRequestComparison, publishPullRequestCheck } };
  });
  return { readSetup, openSetup, verifyCurrentUserAccess, verifyInstalledRepository, readDefaultRevision, readImmutableTree,
    readPullRequestComparison, publishPullRequestCheck };
}

async function proveControlledAssociation(connectionString: string, databaseName: string, adapter: ReturnType<typeof controlledRuntimeAdapter>) {
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

    const auth = await getAuth().$context;
    for (const actor of [owner, reader]) {
      const accessToken = await symmetricEncrypt({ key: auth.secretConfig, data: actor.token });
      const refreshToken = await symmetricEncrypt({ key: auth.secretConfig, data: "ghr_controlled_refresh" });
      await client.query(`UPDATE auth_account SET access_token = $1, refresh_token = $2,
        access_token_expires_at = now() + interval '10 minutes', refresh_token_expires_at = now() + interval '20 minutes'
        WHERE id = $3`, [accessToken, refreshToken, actor.userId + "-account"]);
    }
    // This ephemeral test issues the installed Better Auth cookie format for its own seeded sessions.
    const headersFor = ({ sessionId }: typeof owner) => {
      const value = `${sessionId}-token`;
      const signature = createHmac("sha256", auth.secret).update(value).digest("base64");
      return new Headers({ cookie: `${auth.authCookies.sessionToken.name}=${encodeURIComponent(value + "." + signature)}` });
    };
    const coordinatorHeaders = headersFor(owner);
    const readerHeaders = headersFor(reader);
    expect((await getSession(coordinatorHeaders))?.session.id).toBe(owner.sessionId);
    expect((await getSession(readerHeaders))?.session.id).toBe(reader.sessionId);
    await client.query("UPDATE repository_membership SET active = true WHERE repository_id = $1 AND user_id = $2", [connection.repositoryId, reader.userId]);
    const repositoryId = String(connection.repositoryId);
    adapter.verifyCurrentUserAccess.mockImplementation(lookup);
    adapter.readSetup.mockResolvedValue({ status: "ready", canConfigure: true, sourceRevision });
    expect(await readGitHubSetup(readerHeaders, repositoryId)).toEqual({ status: "ready", canConfigure: false, sourceRevision });
    expect(await openGitHubSetup(readerHeaders, repositoryId, sourceRevision)).toEqual({ status: "forbidden" });
    expect(adapter.openSetup).not.toHaveBeenCalled();

    const proposal = { status: "awaiting_merge", number: 7, url: `https://github.com/${identity.owner}/${identity.name}/pull/7`,
      branch: "nutshell/setup-" + sourceRevision, head: "b".repeat(40), sourceRevision } as const;
    adapter.openSetup.mockImplementationOnce(async () => {
      await client.query("SET lock_timeout = '150ms'");
      try {
        await expect(client.query("UPDATE repository_membership SET active = false WHERE repository_id = $1 AND user_id = $2", [
          connection.repositoryId, owner.userId,
        ])).rejects.toMatchObject({ code: "55P03" });
      } finally {
        await client.query("RESET lock_timeout");
      }
      return proposal;
    });
    expect(await openGitHubSetup(coordinatorHeaders, repositoryId, sourceRevision)).toEqual(proposal);
    expect(adapter.openSetup).toHaveBeenCalledWith(owner.token, connection.installationId, connection.repositoryId,
      { userId: owner.githubId, ownerId: identity.ownerId, nodeId: identity.nodeId, sourceRevision });

    adapter.verifyCurrentUserAccess.mockImplementationOnce(async () => {
      await client.query("UPDATE repository_membership SET active = false WHERE repository_id = $1 AND user_id = $2", [connection.repositoryId, owner.userId]);
      return lookup(owner.token);
    });
    expect(await openGitHubSetup(coordinatorHeaders, repositoryId, sourceRevision)).toEqual({ status: "unavailable" });
    expect(adapter.openSetup).toHaveBeenCalledOnce();

    adapter.readSetup.mockImplementationOnce(async () => {
      await client.query("UPDATE repository_membership SET active = false WHERE repository_id = $1 AND user_id = $2", [connection.repositoryId, reader.userId]);
      return proposal;
    });
    expect(await readGitHubSetup(readerHeaders, repositoryId)).toEqual({ status: "unavailable" });
    return { readerHeaders, readerUserId: reader.userId, coordinatorHeaders, coordinatorUserId: owner.userId };
  } finally {
    await client.end();
  }
}

async function proveControlledIndexing(
  connectionString: string, adapter: ReturnType<typeof controlledRuntimeAdapter>,
  { readerHeaders, readerUserId, coordinatorHeaders, coordinatorUserId }: Awaited<ReturnType<typeof proveControlledAssociation>>,
) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await checkLiveSyncDatabase();
    const files = buildRepositorySetupTree([], { name: identity.name, description: "Controlled repository", entityId: "app" }, "github");
    const tree = { treeSha: "f".repeat(40), files, paths: files.map(({ path }) => path) };
    const push = (revision: string) => ({ ...connection, ownerId: identity.ownerId, repositoryNodeId: identity.nodeId,
      ref: "refs/heads/trunk", revision, deliveryId: randomUUID() });
    const receipt = async (id: string) => (await client.query(`SELECT status, attempts, failure_code
      FROM github_push_delivery WHERE id = $1`, [id])).rows[0];
    const index = async () => (await client.query(`SELECT connection_epoch, head_revision, indexed_revision, status
      FROM github_index_state ORDER BY connection_epoch`)).rows;
    const original = push(sourceRevision);
    expect(await acceptLivePush({ ...original, ownerId: identity.ownerId + 1 })).toBe("unavailable");
    expect(await acceptLivePush({ ...original, repositoryNodeId: "R_other" })).toBe("unavailable");
    expect((await Promise.all([acceptLivePush(original), acceptLivePush(original)])).sort()).toEqual(["accepted", "duplicate"]);
    expect(await acceptLivePush({ ...original, revision: "b".repeat(40) })).toBe("unavailable");
    expect(await receipt(original.deliveryId)).toEqual({ status: "queued", attempts: 0, failure_code: null });
    expect(adapter.verifyInstalledRepository).not.toHaveBeenCalled();

    let head = original.revision;
    adapter.verifyInstalledRepository.mockResolvedValue(identity);
    adapter.readDefaultRevision.mockImplementation(async () => head);
    adapter.readImmutableTree.mockResolvedValue(tree);

    // The prior revoked read was tested separately. Reactivate the isolated test membership for workspace verification.
    const activateReader = (active: boolean) => client.query("UPDATE repository_membership SET active = $1 WHERE repository_id = $2 AND user_id = $3",
      [active, connection.repositoryId, readerUserId]);
    await activateReader(true);
    const readWorkspace = () => readGitHubWorkspace(readerHeaders, String(connection.repositoryId));
    expect(await readGitHubWorkspace(readerHeaders, String(connection.repositoryId + 1))).toBeNull();
    const invalidCookie = new Headers({ cookie: readerHeaders.get("cookie") + "broken" });
    expect(await readGitHubWorkspace(invalidCookie, String(connection.repositoryId))).toBeNull();
    adapter.verifyCurrentUserAccess.mockResolvedValueOnce(null);
    expect(await readWorkspace()).toBeNull();
    expect(adapter.readDefaultRevision).not.toHaveBeenCalled();
    expect(await readWorkspace()).toEqual({
      repository: { id: String(connection.repositoryId), name: `${identity.owner}/${identity.name}`, description: "", role: "read" },
      userId: readerUserId,
      snapshot: { status: "pending", headRevision: original.revision, revision: null, snapshot: null, indexedAt: null },
    });
    expect(adapter.readDefaultRevision).toHaveBeenCalledExactlyOnceWith(identity, expect.any(AbortSignal));

    await closeRuntime();
    expect(await processNextLivePush()).toBe(true);
    expect(await processNextLivePush()).toBe(false);
    expect(await receipt(original.deliveryId)).toEqual({ status: "published", attempts: 1, failure_code: null });
    expect(await index()).toEqual([{ connection_epoch: 1, head_revision: original.revision, indexed_revision: original.revision, status: "current" }]);
    const published = await readWorkspace();
    expect(published?.snapshot).toMatchObject({
      status: "current", headRevision: original.revision, revision: original.revision, indexedAt: expect.any(String),
      snapshot: { entities: [expect.objectContaining({ title: identity.name })], documents: expect.arrayContaining([
        expect.objectContaining({ path: "nutshell-vault/_INDEX.md" }),
      ]) },
    });
    adapter.readDefaultRevision.mockRejectedValueOnce(new GitHubTransportError("provider_unavailable", 503));
    expect(await readWorkspace()).toBeNull();
    adapter.readDefaultRevision.mockImplementationOnce(async () => {
      await activateReader(false);
      return original.revision;
    });
    expect(await readWorkspace()).toBeNull();
    await activateReader(true);

    const superseded = push("b".repeat(40));
    head = superseded.revision;
    expect((await readWorkspace())?.snapshot).toEqual({ ...published?.snapshot, status: "stale", headRevision: head });
    expect(await acceptLivePush(superseded)).toBe("accepted");
    const invalid = push("c".repeat(40));
    adapter.readImmutableTree.mockImplementationOnce(async () => { head = invalid.revision; return tree; });
    expect(await processNextLivePush()).toBe(true);
    expect(await receipt(superseded.deliveryId)).toMatchObject({ status: "obsolete" });
    expect(await acceptLivePush(invalid)).toBe("accepted");
    const rewrite = files.map(({ path, body }) => ({ path, body: path.endsWith("chg_nutshell_setup.json")
      ? JSON.stringify({ ...JSON.parse(body) as object, summary: "Edited a previously accepted event." }) : body }));
    adapter.readImmutableTree.mockResolvedValueOnce({ ...tree, files: rewrite });
    expect(await processNextLivePush()).toBe(true);
    expect(await receipt(invalid.deliveryId)).toEqual({ status: "invalid", attempts: 1, failure_code: "invalid_history" });
    const invalidState = [{ connection_epoch: 1, head_revision: invalid.revision, indexed_revision: original.revision, status: "invalid" }];
    expect(await index()).toEqual(invalidState);
    expect((await readWorkspace())?.snapshot).toEqual({ ...published?.snapshot, status: "invalid", headRevision: invalid.revision });
    expect((await client.query("SELECT source_revision FROM github_accepted_change")).rows).toEqual([{ source_revision: original.revision }]);
    expect((await client.query("SELECT revision FROM github_snapshot")).rows).toEqual([{ revision: original.revision }]);

    const interrupted = push("d".repeat(40));
    head = interrupted.revision;
    expect((await readWorkspace())?.snapshot).toEqual({ ...published?.snapshot, status: "stale", headRevision: head });
    expect(await acceptLivePush(interrupted)).toBe("accepted");
    const stop = new AbortController();
    adapter.readImmutableTree.mockImplementationOnce(async () => { stop.abort(); return tree; });
    expect(await processNextLivePush(stop.signal)).toBe(false);
    expect(await receipt(interrupted.deliveryId)).toEqual({ status: "queued", attempts: 0, failure_code: null });
    expect(await index()).toEqual(invalidState);

    adapter.readDefaultRevision.mockRejectedValueOnce(new GitHubTransportError("rate_limited", 429, 120));
    expect(await processNextLivePush()).toBe(true);
    expect(await receipt(interrupted.deliveryId)).toEqual({ status: "queued", attempts: 1, failure_code: "indexing_error" });
    expect((await client.query(`SELECT available_at > now() + interval '100 seconds' AS waiting
      FROM github_push_delivery WHERE id = $1`, [interrupted.deliveryId])).rows).toEqual([{ waiting: true }]);
    expect(await processNextLivePush()).toBe(false);

    await client.query("UPDATE github_push_delivery SET available_at = now() WHERE id = $1", [interrupted.deliveryId]);
    adapter.readImmutableTree.mockImplementationOnce(async () => {
      await client.query("UPDATE repository SET connection_epoch = connection_epoch + 1 WHERE id = $1", [connection.repositoryId]);
      return tree;
    });
    expect(await processNextLivePush()).toBe(true);
    expect(await receipt(interrupted.deliveryId)).toMatchObject({ status: "obsolete", attempts: 2 });
    expect(await index()).toEqual(invalidState);
    head = invalid.revision;
    expect((await readWorkspace())?.snapshot).toEqual({
      status: "pending", headRevision: invalid.revision, revision: null, indexedAt: null, snapshot: null,
    });

    const unavailable = push("e".repeat(40));
    expect(await acceptLivePush(unavailable)).toBe("accepted");
    adapter.readDefaultRevision.mockRejectedValue(new GitHubTransportError("provider_unavailable", 503));
    for (let attempt = 1; attempt <= 5; attempt++) {
      await client.query("UPDATE github_push_delivery SET available_at = now() WHERE id = $1", [unavailable.deliveryId]);
      expect(await processNextLivePush()).toBe(true);
      expect(await receipt(unavailable.deliveryId)).toEqual({ status: attempt === 5 ? "failed" : "queued",
        attempts: attempt, failure_code: "indexing_error" });
    }
    expect(await processNextLivePush()).toBe(false);
    expect(await index()).toEqual(invalidState);

    const setCoordinatorActive = (active: boolean) => client.query("UPDATE repository_membership SET active = $1 WHERE repository_id = $2 AND user_id = $3",
      [active, connection.repositoryId, coordinatorUserId]);
    await setCoordinatorActive(true);
    head = unavailable.revision;
    adapter.readDefaultRevision.mockImplementation(async () => head);
    const repositoryId = String(connection.repositoryId);
    const reconcile = () => requestGitHubReconciliation(coordinatorHeaders, repositoryId);
    const defaultReads = adapter.readDefaultRevision.mock.calls.length;
    expect(await requestGitHubReconciliation(new Headers(), repositoryId)).toEqual({ status: "unavailable" });
    expect(await requestGitHubReconciliation(readerHeaders, repositoryId)).toEqual({ status: "forbidden" });
    expect(adapter.readDefaultRevision).toHaveBeenCalledTimes(defaultReads);

    const reconcilingReceipts = async () => (await client.query(`SELECT repository_id::int, installation_id::int, owner_id::int,
      repository_node_id, connection_epoch, ref, revision, source, status, attempts FROM github_push_delivery WHERE source = 'reconcile'`)).rows;
    adapter.readDefaultRevision.mockResolvedValueOnce("0".repeat(40));
    expect(await reconcile()).toEqual({ status: "unavailable" });
    expect(await reconcilingReceipts()).toEqual([]);

    const queued = { status: "queued", revision: head };
    expect(await Promise.all([reconcile(), reconcile()])).toEqual([queued, queued]);
    expect(await reconcile()).toEqual(queued);
    const scopedReceipt = { repository_id: connection.repositoryId, installation_id: connection.installationId, owner_id: identity.ownerId,
      repository_node_id: identity.nodeId, connection_epoch: 2, ref: "refs/heads/trunk", revision: head, source: "reconcile" };
    expect(await reconcilingReceipts()).toEqual([{ ...scopedReceipt, status: "queued", attempts: 0 }]);
    expect(await receipt(unavailable.deliveryId)).toMatchObject({ status: "failed", attempts: 5 });

    expect(await processNextLivePush()).toBe(true);
    expect(await reconcilingReceipts()).toEqual([{ ...scopedReceipt, status: "published", attempts: 1 }]);
    expect((await readWorkspace())?.snapshot).toMatchObject({ status: "current", headRevision: head, revision: head });
    expect(await reconcile()).toEqual({ status: "current", revision: head });

    adapter.readDefaultRevision.mockImplementationOnce(async () => {
      await setCoordinatorActive(false);
      return "f".repeat(40);
    });
    expect(await reconcile()).toEqual({ status: "unavailable" });
    expect(await reconcilingReceipts()).toEqual([{ ...scopedReceipt, status: "published", attempts: 1 }]);
  } finally {
    await client.end();
  }
}

async function proveControlledPullChecks(connectionString: string, adapter: ReturnType<typeof controlledRuntimeAdapter>) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const { ownerId, nodeId: repositoryNodeId, defaultBranch: baseBranch } = identity;
    const baseRevision = "e".repeat(40);
    const headRevision = "f".repeat(40);
    const pull = { ...connection, ownerId, repositoryNodeId, baseBranch, pullNumber: 53,
      baseRevision, headRevision, deliveryId: randomUUID() };
    const receipt = async (id: string) => (await client.query(`SELECT status, attempts, check_run_id::int, conclusion
      FROM github_pull_check_delivery WHERE id = $1`, [id])).rows[0];
    expect(await acceptLivePullCheck({ ...pull, ownerId: ownerId + 1 })).toBe("unavailable");
    expect((await Promise.all([acceptLivePullCheck(pull), acceptLivePullCheck(pull)])).sort()).toEqual(["accepted", "duplicate"]);
    expect(await acceptLivePullCheck({ ...pull, headRevision: sourceRevision })).toBe("unavailable");
    expect(await receipt(pull.deliveryId)).toEqual({ status: "queued", attempts: 0, check_run_id: null, conclusion: null });
    expect(adapter.publishPullRequestCheck).not.toHaveBeenCalled();

    const files = buildRepositorySetupTree([], { name: identity.name, description: "Controlled repository", entityId: "app" }, "github");
    const baseFiles = new Map(files.map(({ path, body }) => [path, body]));
    const comparison = { baseRevision, headRevision, baseFiles, headFiles: new Map(baseFiles), changedPaths: [] };
    adapter.readPullRequestComparison.mockResolvedValue(comparison);
    adapter.publishPullRequestCheck.mockImplementation(async (_repo, input) => ({
      id: input.conclusion === "success" ? 901 : 902, head: input.expectedHead, status: "completed", conclusion: input.conclusion,
    }));
    await closeRuntime();
    expect(await processNextLivePullCheck()).toBe(true);
    expect(await receipt(pull.deliveryId)).toEqual({ status: "published", attempts: 1, check_run_id: 901, conclusion: "success" });
    const first = adapter.publishPullRequestCheck.mock.calls[0]?.[1];
    expect(first).toMatchObject({ pullNumber: pull.pullNumber, expectedBase: baseRevision, expectedHead: headRevision,
      conclusion: "success", externalId: expect.stringMatching(/^nutshell-[a-f0-9]{64}$/u) });

    const redelivered = { ...pull, deliveryId: randomUUID() };
    expect(await acceptLivePullCheck(redelivered)).toBe("accepted");
    expect(await processNextLivePullCheck()).toBe(true);
    expect(adapter.publishPullRequestCheck.mock.calls[1]?.[1].externalId).toBe(first?.externalId);
    expect(await receipt(redelivered.deliveryId)).toEqual({ status: "published", attempts: 1, check_run_id: 901, conclusion: "success" });

    const failure = { ...pull, headRevision: "c".repeat(40), deliveryId: randomUUID() };
    const sourcePath = "src/worker.ts";
    adapter.readPullRequestComparison.mockResolvedValueOnce({ ...comparison, headRevision: failure.headRevision,
      headFiles: new Map(baseFiles).set(sourcePath, "export const version = 2;\n"), changedPaths: [sourcePath] });
    expect(await acceptLivePullCheck(failure)).toBe("accepted");
    expect(await processNextLivePullCheck()).toBe(true);
    expect(await receipt(failure.deliveryId)).toEqual({ status: "published", attempts: 1, check_run_id: 902, conclusion: "failure" });
    expect(adapter.publishPullRequestCheck.mock.calls[2]?.[1]).toMatchObject({ expectedHead: failure.headRevision, conclusion: "failure" });

    const obsolete = { ...pull, headRevision: "a".repeat(40), deliveryId: randomUUID() };
    expect(await acceptLivePullCheck(obsolete)).toBe("accepted");
    expect(await processNextLivePullCheck()).toBe(true);
    expect(await receipt(obsolete.deliveryId)).toEqual({ status: "obsolete", attempts: 1, check_run_id: null, conclusion: null });
    expect(adapter.publishPullRequestCheck).toHaveBeenCalledTimes(3);
    expect(await processNextLivePullCheck()).toBe(false);
  } finally {
    await client.end();
  }
}

async function proveControlledRevocation(connectionString: string, adapter: ReturnType<typeof controlledRuntimeAdapter>,
  scope: Awaited<ReturnType<typeof proveControlledAssociation>>) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const { repositoryId, installationId } = connection;
    const { ownerId, nodeId: repositoryNodeId } = identity;
    const { coordinatorHeaders, coordinatorUserId, readerHeaders, readerUserId } = scope;
    await client.query("UPDATE repository_membership SET active = true WHERE repository_id = $1", [repositoryId]);
    const current = await readGitHubWorkspace(coordinatorHeaders, String(repositoryId));
    expect(current?.snapshot).toMatchObject({ status: "current", revision: "e".repeat(40) });
    expect(await getSession(readerHeaders)).not.toBeNull();

    const authorization = randomUUID();
    expect(await acceptLiveRevocation(authorization, { kind: "account", githubUserId: 87652 })).toBe("accepted");
    expect(await acceptLiveRevocation(authorization, { kind: "account", githubUserId: 87652 })).toBe("duplicate");
    expect(await acceptLiveRevocation(authorization, { kind: "account", githubUserId: 76541 })).toBe("unavailable");
    expect(await getSession(readerHeaders)).toBeNull();
    expect(await readGitHubWorkspace(readerHeaders, String(repositoryId))).toBeNull();
    expect(await getSession(coordinatorHeaders)).not.toBeNull();
    expect((await client.query(`SELECT user_id, access_token IS NOT NULL AS access, refresh_token IS NOT NULL AS refresh
      FROM auth_account ORDER BY user_id`)).rows).toEqual([
      { user_id: coordinatorUserId, access: true, refresh: true }, { user_id: readerUserId, access: false, refresh: false },
    ]);
    expect((await client.query("SELECT count(*)::int AS count FROM repository_membership WHERE repository_id = $1", [repositoryId])).rows)
      .toEqual([{ count: 2 }]);

    const selected = repositoryId + 1;
    const remaining = repositoryId + 2;
    const unrelated = repositoryId + 3;
    const unrelatedInstallation = installationId + 1;
    await client.query("INSERT INTO provider_installation (id) VALUES ($1)", [unrelatedInstallation]);
    for (const [id, install] of [[selected, installationId], [remaining, installationId], [unrelated, unrelatedInstallation]]) {
      await client.query("INSERT INTO repository (id, installation_id, name, description) VALUES ($1, $2, 'Synthetic', '')", [id, install]);
      await client.query("INSERT INTO github_repository_association (repository_id, owner_id, repository_node_id) VALUES ($1, $2, $3)",
        [id, ownerId, `R_controlled_${id}`]);
    }
    const repoStates = async () => (await client.query("SELECT id::int, active, connection_epoch AS epoch FROM repository ORDER BY id")).rows;
    const allActive = [{ id: repositoryId, active: true, epoch: 2 }, { id: selected, active: true, epoch: 1 },
      { id: remaining, active: true, epoch: 1 }, { id: unrelated, active: true, epoch: 1 }];
    expect(await repoStates()).toEqual(allActive);
    expect(await acceptLiveRevocation(randomUUID(), { kind: "installation", installationId, ownerId: ownerId + 1 })).toBe("accepted");
    expect(await acceptLiveRevocation(randomUUID(), { kind: "repository", installationId, repositoryId, repositoryNodeId: "R_wrong" })).toBe("accepted");
    const unspecified = randomUUID();
    const unspecifiedScope = { kind: "repository_selection", installationId, ownerId, repositoryIds: [] } as const;
    expect(await acceptLiveRevocation(unspecified, { ...unspecifiedScope, repositoryIds: [] })).toBe("accepted");
    expect(await acceptLiveRevocation(unspecified, { ...unspecifiedScope, repositoryIds: [] })).toBe("duplicate");
    expect(await repoStates()).toEqual(allActive);

    const selectionEvent = randomUUID();
    const selection = { kind: "repository_selection", installationId, ownerId } as const;
    const otherIds = Array.from({ length: 501 }, (_, index) => 9_000 + index);
    expect((await Promise.all([
      acceptLiveRevocation(selectionEvent, { ...selection, repositoryIds: [selected, unrelated, ...otherIds] }),
      acceptLiveRevocation(selectionEvent, { ...selection, repositoryIds: [...otherIds].reverse().concat(unrelated, selected, selected) }),
    ])).sort()).toEqual(["accepted", "duplicate"]);
    expect(await repoStates()).toEqual([allActive[0], { id: selected, active: false, epoch: 2 }, allActive[2], allActive[3]]);
    expect(await readGitHubWorkspace(coordinatorHeaders, String(repositoryId))).not.toBeNull();

    const pending = randomUUID();
    const pendingCheck = randomUUID();
    expect(await acceptLivePush({ deliveryId: pending, repositoryId, installationId, ownerId, repositoryNodeId,
      ref: "refs/heads/trunk", revision: "f".repeat(40) })).toBe("accepted");
    expect(await acceptLivePullCheck({ deliveryId: pendingCheck, repositoryId, installationId, ownerId, repositoryNodeId,
      pullNumber: 54, baseBranch: "trunk", baseRevision: "e".repeat(40), headRevision: "f".repeat(40) })).toBe("accepted");
    expect(await acceptLiveRevocation(randomUUID(), { kind: "repository", installationId, repositoryId, repositoryNodeId })).toBe("accepted");
    expect(await readGitHubWorkspace(coordinatorHeaders, String(repositoryId))).toBeNull();
    expect(await getSession(coordinatorHeaders)).not.toBeNull();
    const treeReads = adapter.readImmutableTree.mock.calls.length;
    expect(await processNextLivePush()).toBe(true);
    expect(adapter.readImmutableTree).toHaveBeenCalledTimes(treeReads);
    expect((await client.query("SELECT status FROM github_push_delivery WHERE id = $1", [pending])).rows).toEqual([{ status: "obsolete" }]);
    const comparisonReads = adapter.readPullRequestComparison.mock.calls.length;
    expect(await processNextLivePullCheck()).toBe(true);
    expect(adapter.readPullRequestComparison).toHaveBeenCalledTimes(comparisonReads);
    expect((await client.query("SELECT status FROM github_pull_check_delivery WHERE id = $1", [pendingCheck])).rows).toEqual([{ status: "obsolete" }]);
    expect((await client.query("SELECT count(*)::int AS count FROM github_snapshot WHERE repository_id = $1", [repositoryId])).rows)
      .toEqual([{ count: 2 }]);

    const suspended = randomUUID();
    const revoke = { kind: "installation", installationId, ownerId } as const;
    expect(await acceptLiveRevocation(suspended, revoke)).toBe("accepted");
    expect(await acceptLiveRevocation(suspended, revoke)).toBe("duplicate");
    expect(await repoStates()).toEqual([{ id: repositoryId, active: false, epoch: 4 }, { id: selected, active: false, epoch: 3 },
      { id: remaining, active: true, epoch: 2 }, allActive[3]]);
    expect((await client.query("SELECT id::int, active FROM provider_installation ORDER BY id")).rows)
      .toEqual([{ id: installationId, active: false }, { id: unrelatedInstallation, active: true }]);
    expect(await acceptLivePush({ deliveryId: randomUUID(), repositoryId: remaining, installationId, ownerId,
      repositoryNodeId: `R_controlled_${remaining}`, ref: "refs/heads/trunk", revision: "f".repeat(40) })).toBe("unavailable");
  } finally {
    await client.end();
  }
}

test.skipIf(process.env.NUTSHELL_VERIFY !== "1")("uses an unseeded PostgreSQL live runtime for access, indexing, Checks and signed revocation", async (context) => {
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
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
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
    const setupAdapter = controlledRuntimeAdapter();

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
    expect(await readGitHubSetup(new Headers(), String(connection.repositoryId))).toEqual({ status: "unavailable" });
    expect(await openGitHubSetup(new Headers(), String(connection.repositoryId), sourceRevision)).toEqual({ status: "unavailable" });
    expect(await readGitHubWorkspace(new Headers(), String(connection.repositoryId))).toBeNull();

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
    const readerScope = await proveControlledAssociation(config.databaseUrl, name, setupAdapter);
    await proveControlledIndexing(config.databaseUrl, setupAdapter, readerScope);
    await proveControlledPullChecks(config.databaseUrl, setupAdapter);
    await proveControlledRevocation(config.databaseUrl, setupAdapter, readerScope);
    expect(outbound).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
