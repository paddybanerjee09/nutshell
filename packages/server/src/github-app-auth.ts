import { createPrivateKey } from "node:crypto";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

export type GitHubAppSettings = {
  appId: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
};

type Environment = Readonly<Record<string, string | undefined>>;
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

function required(env: Environment, name: string, validate: (value: string) => boolean) {
  const value = env[name];
  if (!value || !validate(value)) throw new Error(`Set a valid ${name}.`);
  return value;
}

function secret(value: string, minimum: number) {
  return value.length >= minimum && value.length <= 1024 && value.trim() === value && !/\p{Cc}/u.test(value);
}

export function readGitHubAppSettings(env: Environment = process.env): GitHubAppSettings {
  const appId = required(env, "GITHUB_APP_ID", (value) => /^[1-9][0-9]{0,19}$/u.test(value));
  const clientId = required(env, "GITHUB_APP_CLIENT_ID", (value) => /[A-Za-z]/u.test(value) && /^[A-Za-z0-9_.-]{8,128}$/u.test(value));
  const clientSecret = required(env, "GITHUB_APP_CLIENT_SECRET", (value) => secret(value, 16) && /^[A-Za-z0-9_.-]+$/u.test(value));
  const webhookSecret = required(env, "GITHUB_APP_WEBHOOK_SECRET", (value) => secret(value, 32));
  const privateKey = required(env, "GITHUB_APP_PRIVATE_KEY", (value) => value.length <= 16_384)
    .replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n").trim();
  try {
    if (!/^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n/u.test(privateKey)) throw new Error();
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
  } catch {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be an unencrypted RSA private key of at least 2048 bits.");
  }
  return { appId, clientId, clientSecret, privateKey, webhookSecret };
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
  if (!secret(config.authSecret, 32)) throw new Error("Set a valid BETTER_AUTH_SECRET.");
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
