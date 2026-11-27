import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { isConfiguredSecret, type GitHubAppSettings } from "./github-app-settings.ts";

export { readGitHubAppSettings, type GitHubAppSettings } from "./github-app-settings.ts";

type OAuthOptions = { fetch?: typeof fetch; now?: () => number };
type OAuthCredentials = Pick<GitHubAppSettings, "clientId" | "clientSecret">;

const tokenEndpoint = "https://github.com/login/oauth/access_token";
const authCallback = "/api/auth/callback/github";
const tokenBodyLimit = 16_384;
const tokenTimeoutMs = 10_000;
const accessTokenFormat = /^ghu_[A-Za-z0-9_-]{1,4092}$/u;
const refreshTokenFormat = /^ghr_[A-Za-z0-9_-]{1,4092}$/u;
const reauthorizationErrors = new Set(["bad_refresh_token", "expired_token", "invalid_grant"]);
const providerToken = z.strictObject({
  access_token: z.string().regex(accessTokenFormat),
  refresh_token: z.string().regex(refreshTokenFormat),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token_expires_in: z.number().int().positive().max(31_536_000),
  token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
  scope: z.literal("").optional(),
});

export type GitHubAppOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  tokenType: "bearer";
  scopes: string[];
};

export class GitHubAppUserTokenError extends Error {
  readonly kind: "reauthorize" | "unavailable";

  constructor(kind: "reauthorize" | "unavailable") {
    super(kind === "reauthorize" ? "GitHub App authorization is required." : "GitHub App user credentials are unavailable.");
    this.name = "GitHubAppUserTokenError";
    this.kind = kind;
  }
}

export function validGitHubAppToken(value: unknown, type: "access" | "refresh"): value is string {
  return typeof value === "string" && (type === "access" ? accessTokenFormat : refreshTokenFormat).test(value);
}

async function readTokenPayload(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > tokenBodyLimit || !response.body) throw new GitHubAppUserTokenError("unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let text = "";
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) return JSON.parse(text + decoder.decode()) as unknown;
      length += result.value.byteLength;
      if (length > tokenBodyLimit) throw new GitHubAppUserTokenError("unavailable");
      text += decoder.decode(result.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createGitHubAppOAuthClient(app: OAuthCredentials, options: OAuthOptions = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  async function exchange(fields: Record<string, string>) {
    const started = now();
    try {
      const response = await request(tokenEndpoint, {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(tokenTimeoutMs),
        headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...fields }),
      });
      if (response.status === 429 || response.status >= 500) throw new GitHubAppUserTokenError("unavailable");
      const payload = await readTokenPayload(response);
      const providerError = z.object({ error: z.string() }).safeParse(payload);
      if (providerError.success && fields.grant_type === "refresh_token" && reauthorizationErrors.has(providerError.data.error)) {
        throw new GitHubAppUserTokenError("reauthorize");
      }
      const parsed = providerToken.safeParse(payload);
      if (!response.ok || !parsed.success || parsed.data.refresh_token_expires_in <= parsed.data.expires_in ||
        parsed.data.refresh_token === fields.refresh_token) throw new GitHubAppUserTokenError("unavailable");
      const value = parsed.data;
      return {
        accessToken: value.access_token, refreshToken: value.refresh_token, tokenType: "bearer", scopes: [],
        accessTokenExpiresAt: new Date(started + value.expires_in * 1000),
        refreshTokenExpiresAt: new Date(started + value.refresh_token_expires_in * 1000),
      } satisfies GitHubAppOAuthTokens;
    } catch (error) {
      if (error instanceof GitHubAppUserTokenError) throw error;
      throw new GitHubAppUserTokenError("unavailable");
    }
  }

  return {
    exchangeAuthorizationCode(code: string, redirectURI: string, codeVerifier: string) {
      return exchange({ grant_type: "authorization_code", code, redirect_uri: redirectURI, code_verifier: codeVerifier });
    },
    async refreshAccessToken(token: string) {
      if (!validGitHubAppToken(token, "refresh")) throw new GitHubAppUserTokenError("reauthorize");
      return exchange({ grant_type: "refresh_token", refresh_token: token });
    },
  };
}

function verifiedOrigin(value: string) {
  const error = "GitHub App sign-in requires an HTTPS NUTSHELL_ORIGIN.";
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(error); }
  if (url.protocol !== "https:" || (url.origin !== value && url.origin + "/" !== value)) throw new Error(error);
  return url.origin;
}

export function createGitHubAppAuthOptions(config: { origin: string; authSecret: string; app: GitHubAppSettings },
  options: OAuthOptions & { database: NonNullable<BetterAuthOptions["database"]> }): BetterAuthOptions {
  const origin = verifiedOrigin(config.origin);
  if (!isConfiguredSecret(config.authSecret, 32)) throw new Error("Set a valid BETTER_AUTH_SECRET.");
  const oauth = createGitHubAppOAuthClient(config.app, options);
  const callback = origin + authCallback;
  const appTokenPolicy: BetterAuthPlugin = {
    id: "nutshell-github-app-token-policy",
    hooks: { before: [{
      matcher: (context) => context.path === "/sign-in/social",
      handler: createAuthMiddleware(async ({ request }) => {
        if (request && (request.headers.get("origin") !== origin || new URL(request.url).origin !== origin)) {
          throw new APIError("FORBIDDEN", { message: "A trusted HTTPS origin is required." });
        }
      }),
    }] },
    init(context) {
      return { context: { socialProviders: context.socialProviders.map((provider) => provider.id === "github" ? {
        ...provider,
        createAuthorizationURL: (request) => provider.createAuthorizationURL({ ...request,
          scopes: [], additionalParams: undefined, redirectURI: callback,
        }),
        async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
          if (redirectURI !== callback || !codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) return null;
          try { return await oauth.exchangeAuthorizationCode(code, callback, codeVerifier); } catch { return null; }
        },
      } : provider) } };
    },
  };
  return {
    database: options.database, baseURL: origin, basePath: "/api/auth", secret: config.authSecret, trustedOrigins: [origin],
    advanced: { useSecureCookies: true, disableOriginCheck: false, disableCSRFCheck: false },
    session: { cookieCache: { enabled: false } },
    account: { encryptOAuthTokens: true, storeStateStrategy: "database", skipStateCookieCheck: false,
      storeAccountCookie: false, updateAccountOnSignIn: true, accountLinking: { enabled: false }, },
    disabledPaths: ["/get-access-token", "/refresh-token", "/account-info", "/link-social"],
    socialProviders: { github: {
      clientId: config.app.clientId, clientSecret: config.app.clientSecret, disableDefaultScope: true,
      scope: ["offline_access"], refreshAccessToken: oauth.refreshAccessToken,
    } },
    plugins: [appTokenPolicy],
  };
}
