import { describe, expect, it, vi } from "vitest";
import type { GitHubAppUserTokenResult } from "./github-app-auth-tokens.ts";
import type { GitHubRepositoryAccess } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";
import { createGitHubLiveAccessResolver, type GitHubLiveAccessInput, type GitHubLiveAssociation } from "./github-live-access.ts";

const userId = "stored-local-user";
const accountId = "837";
const accessToken = "ghu_controlled_fixture_credential";
const association: GitHubLiveAssociation = { repositoryId: 512, installationId: 411, ownerId: 71,
  repositoryNodeId: "R_controlled", connectionEpoch: 4 };
const input: GitHubLiveAccessInput = { userId, accountId, association };
const access: GitHubRepositoryAccess = {
  identity: { id: association.repositoryId, installationId: association.installationId, ownerId: association.ownerId,
    nodeId: association.repositoryNodeId, owner: "current-owner-name", name: "current-repo-name", defaultBranch: "main" },
  userId: Number(accountId), role: "read", canRead: true, canWrite: false, canConfigure: false,
};
const token: GitHubAppUserTokenResult = { status: "ready", accountId, accessToken };

function dependencies() {
  type Scope = Parameters<typeof createGitHubLiveAccessResolver>[0];
  return {
    getAccessToken: vi.fn<Scope["getAccessToken"]>().mockResolvedValue(token),
    verifyCurrentUserAccess: vi.fn<Scope["verifyCurrentUserAccess"]>().mockResolvedValue(access),
  };
}

describe("configured GitHub repository access", () => {
  it("checks current user authority for the exact active association and returns no credential", async () => {
    const deps = dependencies();
    const result = await createGitHubLiveAccessResolver(deps).resolve(input);
    expect(deps.getAccessToken).toHaveBeenCalledExactlyOnceWith(userId);
    expect(deps.verifyCurrentUserAccess).toHaveBeenCalledExactlyOnceWith(accessToken, association.installationId, association.repositoryId);
    expect(result).toEqual({ status: "ready", access, userId, accountId, connectionEpoch: association.connectionEpoch });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it("denies inactive or malformed local associations before accessing GitHub credentials", async () => {
    const deps = dependencies();
    const request = createGitHubLiveAccessResolver(deps);
    for (const candidate of [null, { ...association, connectionEpoch: 0 }, { ...association, ownerId: 0 },
      { ...association, repositoryNodeId: " " }]) {
      expect(await request.resolve({ ...input, association: candidate })).toEqual({ status: "denied" });
    }
    expect(await request.resolve({ ...input, userId: "" })).toEqual({ status: "denied" });
    expect(deps.getAccessToken).not.toHaveBeenCalled();
    expect(deps.verifyCurrentUserAccess).not.toHaveBeenCalled();
  });

  it("binds the stored user token to the chosen GitHub account and excludes non-user credentials", async () => {
    const deps = dependencies();
    const request = createGitHubLiveAccessResolver(deps);
    for (const invalid of [null, "0837", "9007199254740992", "unknown"]) {
      expect(await request.resolve({ ...input, accountId: invalid })).toEqual({ status: "reauthorize" });
    }
    expect(deps.getAccessToken).not.toHaveBeenCalled();

    for (const wrongToken of [{ ...token, accountId: "981" }, { ...token, accessToken: "ghs_installation_credential" },
      { ...token, accessToken: "fixture-credential" }]) {
      deps.getAccessToken.mockResolvedValueOnce(wrongToken);
      expect(await createGitHubLiveAccessResolver(deps).resolve(input)).toEqual({ status: "reauthorize" });
    }
    expect(deps.verifyCurrentUserAccess).not.toHaveBeenCalled();
  });

  it("rejects transferred or different repository, installation, node and actor identities", async () => {
    for (const mismatch of [
      { ...access, identity: { ...access.identity, ownerId: 81 } },
      { ...access, identity: { ...access.identity, id: 915 } },
      { ...access, identity: { ...access.identity, installationId: 533 } },
      { ...access, identity: { ...access.identity, nodeId: "R_other" } },
      { ...access, userId: 919 },
    ]) {
      const deps = dependencies();
      deps.verifyCurrentUserAccess.mockResolvedValueOnce(mismatch);
      expect(await createGitHubLiveAccessResolver(deps).resolve(input)).toEqual({ status: "denied" });
    }
  });

  it("reuses a concurrent decision solely within one request and rechecks the next request after revocation", async () => {
    const deps = dependencies();
    const request = createGitHubLiveAccessResolver(deps);
    const concurrent = await Promise.all([request.resolve(input), request.resolve({ ...input, association: { ...association } })]);
    expect(concurrent.map(({ status }) => status)).toEqual(["ready", "ready"]);
    expect(deps.getAccessToken).toHaveBeenCalledTimes(1);
    expect(deps.verifyCurrentUserAccess).toHaveBeenCalledTimes(1);

    deps.verifyCurrentUserAccess.mockResolvedValue(null);
    expect(await createGitHubLiveAccessResolver(deps).resolve(input)).toEqual({ status: "denied" });
    expect(deps.verifyCurrentUserAccess).toHaveBeenCalledTimes(2);
  });

  it("reevaluates both granted and denied decisions after a local reconnect changes the epoch", async () => {
    const deps = dependencies();
    const request = createGitHubLiveAccessResolver(deps);
    deps.verifyCurrentUserAccess.mockResolvedValueOnce(access).mockResolvedValueOnce(null).mockResolvedValueOnce(access);
    expect(await request.resolve(input)).toMatchObject({ status: "ready", connectionEpoch: association.connectionEpoch });
    expect(await request.resolve({ ...input, association: null })).toEqual({ status: "denied" });
    expect(await request.resolve({ ...input, association: { ...association, connectionEpoch: 5 } })).toEqual({ status: "denied" });
    expect(await request.resolve({ ...input, association: { ...association, connectionEpoch: 6 } })).toMatchObject({ status: "ready", connectionEpoch: 6 });
    expect(deps.verifyCurrentUserAccess).toHaveBeenCalledTimes(3);
  });

  it("distinguishes reauthorization, denial and unavailable provider results and hides provider errors", async () => {
    for (const [error, status] of [
      [new GitHubTransportError("unauthenticated", 401), "reauthorize"], [new GitHubTransportError("forbidden", 403), "denied"],
      [new GitHubTransportError("not_found", 404), "denied"], [new GitHubTransportError("rate_limited", 429), "unavailable"],
      [new Error("private response details"), "unavailable"],
    ] as const) {
      const deps = dependencies();
      deps.verifyCurrentUserAccess.mockRejectedValueOnce(error);
      expect(await createGitHubLiveAccessResolver(deps).resolve(input)).toEqual({ status });
    }
    for (const status of ["reauthorize", "unavailable"] as const) {
      const deps = dependencies();
      deps.getAccessToken.mockResolvedValueOnce({ status });
      expect(await createGitHubLiveAccessResolver(deps).resolve(input)).toEqual({ status });
      expect(deps.verifyCurrentUserAccess).not.toHaveBeenCalled();
    }
  });
});
