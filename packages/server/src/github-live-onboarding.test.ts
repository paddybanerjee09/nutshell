import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { expect, test, vi } from "vitest";
import type { GitHubAppUserTokenResult } from "./github-app-auth-tokens.ts";
import type { GitHubRepositoryAccess } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { createGitHubLiveOnboarding } from "./github-live-onboarding.ts";

const actor = { userId: "app-user", sessionId: "app-session" };
const accessToken = "ghu_controlled_access";
const accountId = "7654321";
const input = { repositoryId: 840123, installationId: 981456 };
const identity = {
  id: input.repositoryId, installationId: input.installationId, ownerId: 45632, nodeId: "R_verified_node",
  owner: "project-owner", name: "project-repository", defaultBranch: "trunk",
};
const admin: GitHubRepositoryAccess = { userId: Number(accountId), identity, role: "admin", canRead: true, canWrite: true, canConfigure: true };
const readOnly: GitHubRepositoryAccess = { ...admin, role: "read", canWrite: false, canConfigure: false };
const discovery = {
  userId: Number(accountId), installationUrl: "https://github.com/apps/nutshell-sandbox/installations/new",
  candidates: [{ ...input, owner: identity.owner, name: identity.name }],
};

function controlledDatabase() {
  const state = {
    linked: [["linked-row", accountId]], signedIn: true, availableLease: true,
    install: undefined as boolean | undefined,
    repository: undefined as { active: boolean; installationId: number; epoch: number } | undefined,
    association: undefined as { ownerId: number; nodeId: string } | undefined,
    member: undefined as boolean | undefined,
    insertAssociation: true,
  };
  const statements: { sql: string; parameters: unknown[] }[] = [];
  const query = async (query: string | { text: string }, parameters: unknown[] = []): Promise<{ rows: unknown[] }> => {
    const sql = typeof query === "string" ? query : query.text;
    statements.push({ sql, parameters });
    if (sql.includes('from "auth_account"')) return { rows: state.linked };
    if (sql.includes('from "auth_user"')) return { rows: [[actor.userId]] };
    if (sql.includes('from "auth_session"')) return { rows: state.signedIn ? [[actor.sessionId]] : [] };
    if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ locked: state.availableLease }] };
    if (sql.includes('from "provider_installation"')) return { rows: state.install === undefined ? [] : [[state.install]] };
    if (sql.startsWith('select "connection_epoch"')) return { rows: state.repository ? [[state.repository.epoch]] : [] };
    if (sql.includes('from "repository"')) {
      const repo = state.repository;
      return { rows: repo ? [[repo.active, repo.installationId, repo.epoch]] : [] };
    }
    if (sql.includes('from "github_repository_association"')) {
      return { rows: state.association ? [[state.association.ownerId, state.association.nodeId]] : [] };
    }
    if (sql.includes('from "repository_membership"')) return { rows: state.member === undefined ? [] : [[state.member]] };
    if (sql.startsWith('insert into "github_repository_association"') && !state.insertAssociation) return { rows: [] };
    if (sql.startsWith("insert into")) return { rows: [[input.repositoryId]] };
    return { rows: [] };
  };
  const getAccessToken = vi.fn(async (): Promise<GitHubAppUserTokenResult> => ({ status: "ready", accessToken, accountId }));
  const discoverConnections = vi.fn(async () => discovery);
  const verifyCurrentUserAccess = vi.fn(async (): Promise<GitHubRepositoryAccess | null> => admin);
  const service = createGitHubLiveOnboarding(drizzle({ query } as unknown as pg.Client), {
    getAccessToken, repository: { discoverConnections, verifyCurrentUserAccess },
  });

  function existingAssociation() {
    state.install = true;
    state.repository = { active: true, epoch: 1, installationId: input.installationId };
    state.association = { ownerId: identity.ownerId, nodeId: identity.nodeId };
  }

  return { state, service, getAccessToken, discoverConnections, verifyCurrentUserAccess, statements, existingAssociation };
}

test("discloses Provider discovery only after checking the exact linked identity and rechecking the session", async () => {
  const { service, getAccessToken, discoverConnections, state } = controlledDatabase();
  expect(await service.list(actor)).toEqual({ status: "ready", installationUrl: discovery.installationUrl, candidates: discovery.candidates });
  expect(getAccessToken).toHaveBeenCalledWith(actor.userId);
  expect(discoverConnections).toHaveBeenCalledWith(accessToken);
  discoverConnections.mockResolvedValueOnce({ ...discovery, userId: 2345678 });
  expect(await service.list(actor)).toEqual({ status: "reauthorize" });

  discoverConnections.mockImplementationOnce(async () => {
    state.signedIn = false;
    return discovery;
  });
  expect(await service.list(actor)).toEqual({ status: "unavailable" });
});

test("refuses ambiguous and changed links, and surfaces token reauthorization without a fallback", async () => {
  const { service, getAccessToken, discoverConnections, state } = controlledDatabase();
  state.linked = [["linked-row", accountId], ["another-link", accountId]];
  expect(await service.list(actor)).toEqual({ status: "reauthorize" });
  expect(getAccessToken).not.toHaveBeenCalled();

  state.linked = [["linked-row", accountId]];
  getAccessToken.mockResolvedValueOnce({ status: "ready", accessToken, accountId: "3333333" });
  expect(await service.list(actor)).toEqual({ status: "reauthorize" });
  expect(discoverConnections).not.toHaveBeenCalled();
  discoverConnections.mockImplementationOnce(async () => {
    state.linked = [["replacement-row", accountId]];
    return discovery;
  });
  expect(await service.list(actor)).toEqual({ status: "reauthorize" });
  discoverConnections.mockRejectedValueOnce(new GitHubTransportError("unauthenticated", 401));
  expect(await service.list(actor)).toEqual({ status: "reauthorize" });
});

test("requires an exact current administrative grant for a new association and writes only provider identity facts", async () => {
  const { service, statements, verifyCurrentUserAccess } = controlledDatabase();
  verifyCurrentUserAccess.mockResolvedValueOnce(readOnly)
    .mockResolvedValueOnce({ ...admin, canWrite: false, canConfigure: false })
    .mockResolvedValueOnce({ ...admin, identity: { ...identity, installationId: 8888 } });
  for (let denial = 0; denial < 3; denial++) expect(await service.connect(actor, input)).toEqual({ status: "denied" });
  expect(statements.some(({ sql }) => sql.startsWith("insert into"))).toBe(false);
  expect(await service.connect(actor, input)).toEqual({ status: "connected", repositoryId: String(input.repositoryId) });
  expect(verifyCurrentUserAccess).toHaveBeenLastCalledWith(accessToken, input.installationId, input.repositoryId);
  const inserts = statements.filter(({ sql }) => sql.startsWith("insert into"));
  expect(inserts.map(({ parameters }) => parameters)).toEqual([
    [input.installationId], [input.repositoryId, input.installationId, `${identity.owner}/${identity.name}`, ""],
    [input.repositoryId, identity.ownerId, identity.nodeId], [actor.userId, input.repositoryId],
  ]);
  expect(statements.at(-1)?.sql).toBe("commit");
});

test("allows readable membership only for the exact active association and leaves revoked membership untouched", async () => {
  const { service, state, statements, verifyCurrentUserAccess, existingAssociation } = controlledDatabase();
  existingAssociation();
  verifyCurrentUserAccess.mockResolvedValue(readOnly);
  state.member = false;
  expect(await service.connect(actor, input)).toEqual({ status: "denied" });
  state.member = undefined;
  state.install = false;
  expect(await service.connect(actor, input)).toEqual({ status: "conflict" });
  state.install = true;
  state.association = { ownerId: 12, nodeId: identity.nodeId };
  expect(await service.connect(actor, input)).toEqual({ status: "conflict" });
  existingAssociation();
  expect(await service.connect(actor, input)).toEqual({ status: "connected", repositoryId: String(input.repositoryId) });
  const inserts = statements.filter(({ sql }) => sql.startsWith("insert into"));
  expect(inserts).toEqual([{ sql: expect.stringContaining('insert into "repository_membership"'), parameters: [actor.userId, input.repositoryId] }]);
  expect(statements.some(({ sql }) => sql.startsWith("update"))).toBe(false);
});

test("stale epochs and concurrent connections stop before writes, and node collisions roll back bootstrap", async () => {
  const { service, state, statements, verifyCurrentUserAccess, existingAssociation } = controlledDatabase();
  existingAssociation();
  verifyCurrentUserAccess.mockImplementationOnce(async () => {
    state.repository = { active: true, epoch: 2, installationId: input.installationId };
    return admin;
  });
  expect(await service.connect(actor, input)).toEqual({ status: "conflict" });
  state.availableLease = false;
  expect(await service.connect(actor, input)).toEqual({ status: "conflict" });
  expect(statements.some(({ sql }) => sql.startsWith("insert into"))).toBe(false);

  state.availableLease = true;
  state.repository = undefined;
  state.install = undefined;
  state.insertAssociation = false;
  expect(await service.connect(actor, input)).toEqual({ status: "conflict" });
  expect(statements.at(-1)?.sql).toBe("rollback");
});
