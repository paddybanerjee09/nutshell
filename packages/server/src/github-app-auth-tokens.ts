import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createGitHubAppOAuthClient, GitHubAppUserTokenError, validGitHubAppToken, type GitHubAppSettings } from "./github-app-auth.ts";
import { account } from "./schema.ts";

type TokenFields = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
};

export type GitHubAppAccountTokens = { accountId: string } & { [Key in keyof TokenFields]: TokenFields[Key] | null };
export type GitHubAppAccountStore = {
  // Hold the account row lock across exchange and replacement. GitHub's old refresh token is consumed on the first exchange.
  withLockedAccount<T>(userId: string, use: (tokens: GitHubAppAccountTokens, replace: (encrypted: TokenFields) => Promise<boolean>) => Promise<T>): Promise<T | null>;
};

export type GitHubAppUserTokenResult = { status: "ready"; accessToken: string; accountId: string }
  | { status: "reauthorize" | "unavailable" };

const refreshWindowMs = 60_000;

export function createGitHubAppDrizzleTokenStore(database: Pick<NodePgDatabase, "transaction">): GitHubAppAccountStore {
  return {
    withLockedAccount(userId, use) {
      return database.transaction(async (tx) => {
        const scope = and(eq(account.userId, userId), eq(account.providerId, "github"));
        const [row, duplicate] = await tx.select({ id: account.id, accountId: account.accountId,
          accessToken: account.accessToken, refreshToken: account.refreshToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt, refreshTokenExpiresAt: account.refreshTokenExpiresAt,
        }).from(account).where(scope).limit(2).for("update");
        if (!row || duplicate) return null;
        return use(row, async (encrypted) => {
          const updated = await tx.update(account).set({ ...encrypted, updatedAt: new Date() })
            .where(and(scope, eq(account.id, row.id), sql`${account.refreshToken} is not distinct from ${row.refreshToken}`))
            .returning({ id: account.id });
          return updated.length === 1;
        });
      });
    },
  };
}

export function createGitHubAppUserTokens({ app, store, encryptionKey, fetch: request, now = Date.now }: {
  app: Pick<GitHubAppSettings, "clientId" | "clientSecret">;
  store: GitHubAppAccountStore;
  // Take Better Auth's context secretConfig so versioned and legacy ciphertext use the same keys as sign-in.
  encryptionKey: Parameters<typeof symmetricEncrypt>[0]["key"];
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const oauth = createGitHubAppOAuthClient(app, { fetch: request, now });
  return {
    async getAccessToken(userId: string): Promise<GitHubAppUserTokenResult> {
      if (!userId) return { status: "reauthorize" };
      try {
        const result = await store.withLockedAccount<GitHubAppUserTokenResult>(userId, async (stored, replace) => {
          if (!stored.accessToken || !stored.refreshToken || !/^[1-9][0-9]{0,19}$/u.test(stored.accountId)) return { status: "reauthorize" };
          const accessExpiry = stored.accessTokenExpiresAt?.getTime();
          const refreshExpiry = stored.refreshTokenExpiresAt?.getTime();
          const time = now();
          if (accessExpiry === undefined || refreshExpiry === undefined || !Number.isFinite(accessExpiry) || !Number.isFinite(refreshExpiry) ||
            refreshExpiry <= time || refreshExpiry <= accessExpiry) return { status: "reauthorize" };

          const [accessToken, refreshToken] = await Promise.all([
            symmetricDecrypt({ key: encryptionKey, data: stored.accessToken }),
            symmetricDecrypt({ key: encryptionKey, data: stored.refreshToken }),
          ]);
          if (!validGitHubAppToken(accessToken, "access") || !validGitHubAppToken(refreshToken, "refresh")) return { status: "reauthorize" };
          if (accessExpiry > time + refreshWindowMs) return { status: "ready", accessToken, accountId: stored.accountId };

          const rotated = await oauth.refreshAccessToken(refreshToken);
          if (rotated.accessToken === accessToken || rotated.accessTokenExpiresAt.getTime() <= now()) return { status: "unavailable" };
          const [sealedAccess, sealedRefresh] = await Promise.all([
            symmetricEncrypt({ key: encryptionKey, data: rotated.accessToken }),
            symmetricEncrypt({ key: encryptionKey, data: rotated.refreshToken }),
          ]);
          const saved = await replace({ accessToken: sealedAccess, refreshToken: sealedRefresh,
            accessTokenExpiresAt: rotated.accessTokenExpiresAt, refreshTokenExpiresAt: rotated.refreshTokenExpiresAt,
          });
          return saved ? { status: "ready", accessToken: rotated.accessToken, accountId: stored.accountId } : { status: "unavailable" };
        });
        return result ?? { status: "reauthorize" };
      } catch (error) {
        return { status: error instanceof GitHubAppUserTokenError ? error.kind : "unavailable" };
      }
    },
  };
}
