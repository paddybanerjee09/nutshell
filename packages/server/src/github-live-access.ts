import { validGitHubAppToken } from "./github-app-auth.ts";
import type { GitHubAppUserTokenResult } from "./github-app-auth-tokens.ts";
import type { GitHubAppRepository, GitHubRepositoryAccess } from "./github-app-repository.ts";
import { GitHubTransportError } from "./github-app-transport.ts";

export type GitHubLiveAssociation = {
  repositoryId: number;
  installationId: number;
  ownerId: number;
  repositoryNodeId: string;
  connectionEpoch: number;
};

export type GitHubLiveAccessInput = {
  userId: string;
  accountId: string | null;
  association: GitHubLiveAssociation | null;
};

export type GitHubLiveAccessResult =
  | { status: "ready"; access: GitHubRepositoryAccess; userId: string; accountId: string; connectionEpoch: number }
  | { status: "denied" | "reauthorize" | "unavailable" };

type LiveAccessDependencies = {
  getAccessToken: (userId: string) => Promise<GitHubAppUserTokenResult>;
  verifyCurrentUserAccess: GitHubAppRepository["verifyCurrentUserAccess"];
};

function positiveId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function opaqueId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.isWellFormed() && !/[\s\p{Cc}]/u.test(value);
}

function validAssociation(value: GitHubLiveAssociation | null): value is GitHubLiveAssociation {
  return Boolean(value && positiveId(value.repositoryId) && positiveId(value.installationId) && positiveId(value.ownerId)
    && opaqueId(value.repositoryNodeId) && positiveId(value.connectionEpoch));
}

/** Create a fresh resolver per protected request, after selecting the active local membership and association. */
export function createGitHubLiveAccessResolver({ getAccessToken, verifyCurrentUserAccess }: LiveAccessDependencies) {
  const requestDecisions = new Map<string, Promise<GitHubLiveAccessResult>>();

  async function check(userId: string, accountId: string, local: GitHubLiveAssociation): Promise<GitHubLiveAccessResult> {
    try {
      const token = await getAccessToken(userId);
      if (token.status !== "ready") return { status: token.status };
      if (token.accountId !== accountId || !validGitHubAppToken(token.accessToken, "access")) return { status: "reauthorize" };

      const access = await verifyCurrentUserAccess(token.accessToken, local.installationId, local.repositoryId);
      if (!access || access.canRead !== true || String(access.userId) !== accountId || access.identity.id !== local.repositoryId
        || access.identity.installationId !== local.installationId || access.identity.ownerId !== local.ownerId
        || access.identity.nodeId !== local.repositoryNodeId) return { status: "denied" };

      return { status: "ready", access, userId, accountId, connectionEpoch: local.connectionEpoch };
    } catch (error) {
      if (error instanceof GitHubTransportError) {
        if (error.code === "unauthenticated") return { status: "reauthorize" };
        if (error.code === "forbidden" || error.code === "not_found") return { status: "denied" };
      }
      return { status: "unavailable" };
    }
  }

  return {
    resolve({ userId, accountId, association }: GitHubLiveAccessInput): Promise<GitHubLiveAccessResult> {
      if (!opaqueId(userId) || !validAssociation(association)) return Promise.resolve({ status: "denied" });
      if (accountId === null || !/^[1-9]\d{0,15}$/u.test(accountId) || !positiveId(Number(accountId))) {
        return Promise.resolve({ status: "reauthorize" });
      }

      const local = { ...association };
      const key = JSON.stringify([userId, accountId, local.repositoryId, local.installationId, local.ownerId,
        local.repositoryNodeId, local.connectionEpoch]);
      let decision = requestDecisions.get(key);
      if (!decision) {
        decision = check(userId, accountId, local);
        requestDecisions.set(key, decision);
      }
      return decision;
    },
  };
}
