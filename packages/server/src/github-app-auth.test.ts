import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppAuthOptions, createGitHubAppOAuthClient, readGitHubAppSettings } from "./github-app-auth.ts";
import { createGitHubAppUserTokens, type GitHubAppAccountStore, type GitHubAppAccountTokens } from "./github-app-auth-tokens.ts";

const authSecret = randomBytes(32).toString("base64url");
const origin = "https://nutshell.example.test";
const time = Date.UTC(2026, 10, 27, 13);
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }, }).privateKey;
const environment = {
  GITHUB_APP_ID: "1234",
  GITHUB_APP_CLIENT_ID: "Iv1.fixture-client",
  GITHUB_APP_CLIENT_SECRET: "controlled-test-client-secret",
  GITHUB_APP_PRIVATE_KEY: privateKey.replaceAll("\n", "\\n"),
  GITHUB_APP_WEBHOOK_SECRET: "controlled-webhook-secret-0123456789",
};
const app = readGitHubAppSettings(environment);
const initial = {
  access_token: "ghu_initial_fixture", refresh_token: "ghr_initial_fixture", token_type: "bearer", scope: "",
  expires_in: 28_800, refresh_token_expires_in: 15_897_600,
};
const rotated = { ...initial, access_token: "ghu_rotated_fixture", refresh_token: "ghr_rotated_fixture" };

afterEach(() => vi.unstubAllGlobals());

function beginSignIn(auth: { handler: (request: Request) => Promise<Response> }, requestOrigin = origin) {
  return auth.handler(new Request(origin + "/api/auth/sign-in/social", {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", callbackURL: origin + "/app", scopes: ["repo", "user:email"],
      additionalParams: { repository_id: "1001" }, }),
  }));
}

type AccountRow = { accessToken: string; refreshToken: string; accessTokenExpiresAt: Date; refreshTokenExpiresAt: Date; accountId: string };

function fakeAuth(request: typeof fetch) {
  const database = { user: [], account: [] as AccountRow[], session: [], verification: [] };
  const config = createGitHubAppAuthOptions({ origin, authSecret, app }, { database: memoryAdapter(database), fetch: request, now: () => time });
  return { auth: betterAuth({ ...config, logger: { disabled: true } }), database };
}

async function encryptedRecord(accessToken = initial.access_token): Promise<GitHubAppAccountTokens> {
  return {
    accountId: "40217", accessToken: await symmetricEncrypt({ key: authSecret, data: accessToken }),
    refreshToken: await symmetricEncrypt({ key: authSecret, data: initial.refresh_token }),
    accessTokenExpiresAt: new Date(time - 1), refreshTokenExpiresAt: new Date(time + 86_400_000),
  };
}

function serializedStore(start: GitHubAppAccountTokens, failReplacement = false) {
  let current = start;
  let last = Promise.resolve();
  const store: GitHubAppAccountStore = {
    withLockedAccount(userId, use) {
      const next = last.then(() => userId === "member" ? use(current, async (pair) => {
        if (failReplacement) return false;
        current = { ...current, ...pair };
        return true;
      }) : null);
      last = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { store, read: () => current };
}

describe("GitHub App authorization", () => {
  it("validates all App settings and normalizes an escaped RSA key", () => {
    expect(app.privateKey).toEqual(privateKey.trim());
    for (const key of Object.keys(environment)) {
      expect(() => readGitHubAppSettings({ ...environment, [key]: undefined })).toThrow(key);
    }
    expect(() => readGitHubAppSettings({ ...environment, GITHUB_APP_ID: "1e5" })).toThrow("GITHUB_APP_ID");
    expect(() => readGitHubAppSettings({ ...environment, GITHUB_APP_PRIVATE_KEY: "invalid-private-configuration" }))
      .toThrow("unencrypted RSA private key");
    expect(() => createGitHubAppAuthOptions({ origin: "http://nutshell.example.test", authSecret, app }, { database: memoryAdapter({}) }))
      .toThrow("HTTPS NUTSHELL_ORIGIN");
  });

  it("uses real Better Auth state, PKCE S256, secure cookies, and encrypted App grants", { timeout: 20_000 }, async () => {
    const provider = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url === "https://github.com/login/oauth/access_token") return Response.json(initial);
      expect(request.headers.get("authorization")).toBe(`Bearer ${initial.access_token}`);
      if (request.url === "https://api.github.com/user") {
        return Response.json({ id: 40217, login: "app-fixture", name: "App fixture", email: null });
      }
      if (request.url === "https://api.github.com/user/emails") {
        return Response.json([{ email: "app-fixture@example.test", primary: true, verified: true }]);
      }
      throw new Error("Unexpected controlled provider request");
    });
    vi.stubGlobal("fetch", provider);
    const { auth, database } = fakeAuth(provider);
    expect((await beginSignIn(auth, "https://untrusted.example.test")).status).toBe(403);
    const start = await beginSignIn(auth);
    expect(start.status).toBe(200);
    const destination = new URL((await start.json() as { url: string }).url);
    expect(destination.origin + destination.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(destination.searchParams.get("scope")).toBe("offline_access");
    expect(destination.searchParams.has("repository_id")).toBe(false);
    expect(destination.searchParams.get("code_challenge_method")).toBe("S256");
    const state = destination.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    const cookie = start.headers.getSetCookie().find((item) => item.startsWith("__Secure-") && item.includes(".state="));
    expect(cookie).toMatch(/;\s*Secure(?:;|$)/iu);
    expect(cookie).toMatch(/;\s*HttpOnly(?:;|$)/iu);
    expect(cookie).toMatch(/;\s*SameSite=Lax(?:;|$)/iu);
    expect(cookie).not.toMatch(/;\s*Domain=/iu);
    const callback = origin + "/api/auth/callback/github?";
    const headers = { cookie: cookie!.split(";", 1)[0]! };
    expect((await auth.handler(new Request(callback + new URLSearchParams({ state: "mismatched", code: "fixture-code" }), { headers }))).status)
      .toBe(302);
    expect((await auth.handler(new Request(callback + new URLSearchParams({ state: state!, code: "fixture-code" })))).status).toBe(302);
    expect(provider).not.toHaveBeenCalled();

    const result = await auth.handler(new Request(callback + new URLSearchParams({ state: state!, code: "fixture-code" }), { headers }));
    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe(origin + "/app");
    const exchange = provider.mock.calls.find(([input]) => String(input) === "https://github.com/login/oauth/access_token")?.[1];
    expect(exchange?.redirect).toBe("error");
    const form = exchange?.body as URLSearchParams;
    expect(form.get("redirect_uri")).toBe(origin + "/api/auth/callback/github");
    expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(destination.searchParams.get("code_challenge"));
    const [stored] = database.account;
    expect(stored?.accountId).toBe("40217");
    expect(stored?.accessToken).not.toBe(initial.access_token);
    expect(stored?.refreshToken).not.toBe(initial.refresh_token);
    const encryptionKey = (await auth.$context).secretConfig;
    expect(await symmetricDecrypt({ key: encryptionKey, data: stored!.accessToken })).toBe(initial.access_token);
    expect(await symmetricDecrypt({ key: encryptionKey, data: stored!.refreshToken })).toBe(initial.refresh_token);
    expect(stored?.accessTokenExpiresAt.getTime()).toBe(time + initial.expires_in * 1000);
    expect(stored?.refreshTokenExpiresAt.getTime()).toBe(time + initial.refresh_token_expires_in * 1000);
    expect(result.headers.getSetCookie().find((item) => /__Secure-.*session_token=/u.test(item))).toMatch(/HttpOnly/iu);
    for (const path of ["get-access-token", "refresh-token"]) {
      expect((await auth.handler(new Request(origin + "/api/auth/" + path, { method: "POST", headers: { origin } }))).status).toBe(404);
    }
  });
});

describe("GitHub App user-token rotation", () => {
  it("rotates both tokens under a shared account lock and returns only the committed grant", async () => {
    const { store, read } = serializedStore(await encryptedRecord());
    const request = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe("https://github.com/login/oauth/access_token");
      expect(init?.redirect).toBe("error");
      const form = init?.body as URLSearchParams;
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("client_id")).toBe(app.clientId);
      expect(form.get("client_secret")).toBe(app.clientSecret);
      expect(form.get("refresh_token")).toBe(initial.refresh_token);
      return Response.json(rotated);
    });
    const options = { app, store, encryptionKey: authSecret, fetch: request, now: () => time };
    const both = await Promise.all([createGitHubAppUserTokens(options).getAccessToken("member"), createGitHubAppUserTokens(options).getAccessToken("member")]);
    expect(both).toEqual([0, 1].map(() => ({ status: "ready", accessToken: rotated.access_token, accountId: "40217" })));
    expect(request).toHaveBeenCalledTimes(1);
    const saved = read();
    expect(saved.refreshToken).not.toBe(rotated.refresh_token);
    expect(await symmetricDecrypt({ key: authSecret, data: saved.refreshToken! })).toBe(rotated.refresh_token);
    expect(saved.refreshTokenExpiresAt?.getTime()).toBe(time + rotated.refresh_token_expires_in * 1000);
  });

  it("fails closed on missing, expired, or wrong-authority credentials", async () => {
    const request = vi.fn<typeof fetch>();
    const expired = { ...await encryptedRecord(), refreshTokenExpiresAt: new Date(time - 1) };
    const wrongType = await encryptedRecord("ghs_installation_fixture");
    for (const record of [expired, wrongType]) {
      const { store } = serializedStore(record);
      const manager = createGitHubAppUserTokens({ app, store, encryptionKey: authSecret, fetch: request, now: () => time });
      expect(await manager.getAccessToken("member")).toEqual({ status: "reauthorize" });
      expect(await manager.getAccessToken("other")).toEqual({ status: "reauthorize" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("rejects replayed rotations and sanitizes provider failure responses", async () => {
    const request = vi.fn<typeof fetch>();
    const client = createGitHubAppOAuthClient(app, { fetch: request, now: () => time });
    request.mockResolvedValueOnce(Response.json({ error: "bad_refresh_token", error_description: "controlled-private-detail" }));
    await expect(client.refreshAccessToken(initial.refresh_token)).rejects.toMatchObject({ kind: "reauthorize", message: "GitHub App authorization is required." });
    request.mockResolvedValueOnce(Response.json({ ...rotated, refresh_token: initial.refresh_token }));
    await expect(client.refreshAccessToken(initial.refresh_token)).rejects.toMatchObject({ kind: "unavailable" });
    request.mockResolvedValueOnce(Response.json({ ...rotated, access_token: "ghs_wrong_authority" }));
    await expect(client.refreshAccessToken(initial.refresh_token)).rejects.toMatchObject({ kind: "unavailable" });
    request.mockResolvedValueOnce(new Response("x".repeat(17_000)));
    await expect(client.refreshAccessToken(initial.refresh_token)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("withholds freshly minted credentials if the conditional save fails or ciphertext cannot open", async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(rotated));
    const initialRow = await encryptedRecord();
    const { store, read } = serializedStore(initialRow, true);
    const options = { app, store, encryptionKey: authSecret, fetch: request, now: () => time };
    expect(await createGitHubAppUserTokens(options).getAccessToken("member")).toEqual({ status: "unavailable" });
    expect(read()).toEqual(initialRow);
    expect(await createGitHubAppUserTokens({ ...options, encryptionKey: randomBytes(32).toString("base64url") }).getAccessToken("member"))
      .toEqual({ status: "unavailable" });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
