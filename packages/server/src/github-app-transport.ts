import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";

const origin = "https://api.github.com";
const restApiVersion = "2026-03-10";
const responseBytes = 8 * 1024 * 1024;
const requestTimeout = 15_000;
const tokenRefreshWindow = 60_000;
const maxInstallationScopes = 128;
const graphUrl = new URL("/graphql", origin);
const bearerPattern = /^[A-Za-z0-9._~+/-]+=*$/u;
const appReadEndpoint = /^\/(?:app(?:\/installations(?:\/[1-9]\d*)?)?|repos\/[^/]+\/[^/]+\/installation)$/u;
const namedRepositoryPath = /^\/repos\/[^/]+\/[^/]+(\/.*)?$/u;
const numberedRepositoryPath = /^\/repositories\/([1-9]\d*)(\/.*)?$/u;
const pagingParameters = new Set(["page", "per_page", "after", "before", "since"]);
const levels = z.enum(["read", "write"]);
const installationPermissions = z.strictObject({
  metadata: z.literal("read").optional(),
  contents: z.literal("read").optional(),
  pull_requests: z.literal("read").optional(),
  checks: levels.optional(),
});
const installationReply = z.object({
  token: z.string(),
  expires_at: z.iso.datetime({ offset: true }),
  permissions: installationPermissions,
  repositories: z.array(z.object({ id: z.number().int().positive() })).min(1).max(500),
});

const errorMessages = {
  invalid_request: "The GitHub request is invalid.",
  unauthenticated: "GitHub credentials are unavailable or invalid.",
  forbidden: "GitHub denied this operation.",
  not_found: "The GitHub resource is unavailable.",
  conflict: "The GitHub resource has changed.",
  validation: "GitHub rejected the request.",
  rate_limited: "GitHub has limited API requests.",
  provider_unavailable: "The GitHub API is unavailable.",
  invalid_response: "GitHub returned an invalid response.",
  pagination_limit: "The GitHub result exceeds the pagination limits.",
} as const;
export type GitHubTransportErrorCode = keyof typeof errorMessages;

export class GitHubTransportError extends Error {
  readonly code: GitHubTransportErrorCode;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(code: GitHubTransportErrorCode, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(errorMessages[code]);
    this.name = "GitHubTransportError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type GitHubInstallationPermissions = z.infer<typeof installationPermissions>;
export type GitHubInstallationScope = {
  installationId: number;
  repositoryIds: readonly number[];
  permissions: GitHubInstallationPermissions;
};
export type GitHubRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
};
export type GitHubPageOptions = {
  key?: string;
  maxPages?: number;
  maxItems?: number;
  repositoryId?: number;
  signal?: AbortSignal;
};
type GitHubAppTransportOptions = {
  appId: string;
  privateKey: string;
  clientId?: string;
  fetch?: typeof fetch;
  now?: () => number;
};
type Reply = { data: unknown; headers: Headers };
type Token = { value: string; expiresAt: number; mintedAt: number };
type ScopedInstallation = GitHubInstallationScope & { cacheKey: string };
type ReadPage = (url: URL, signal?: AbortSignal) => Promise<Reply>;

export type GitHubAppTransport = {
  readonly appId: number;
  appRequest(path: string, options?: GitHubRequestOptions): Promise<unknown>;
  userRequest(userToken: string, path: string, options?: GitHubRequestOptions): Promise<unknown>;
  userGraphql(userToken: string, query: string, variables?: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<unknown>;
  installationRequest(scope: GitHubInstallationScope, path: string, options?: GitHubRequestOptions): Promise<unknown>;
  userPages(userToken: string, path: string, options?: GitHubPageOptions): Promise<unknown[]>;
  installationPages(scope: GitHubInstallationScope, path: string, options?: GitHubPageOptions): Promise<unknown[]>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function credential(value: unknown): value is string {
  return typeof value === "string" && value.length <= 8_192 && bearerPattern.test(value);
}

function positiveId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function safePath(path: string) {
  const decoded = decodeURIComponent(path);
  return !/[\\\p{Cc}]/u.test(decoded) && decoded.split("/").every((part) => part !== "." && part !== "..");
}

function apiUrl(value: string, base: string | URL = origin) {
  try {
    if (value.length > 8_192 || /[\\#\s\p{Cc}]/u.test(value)) return null;
    const path = value.split("?", 1)[0]!;
    if (!safePath(path)) return null;
    const url = new URL(value, base);
    return url.origin === origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function restUrl(path: string) {
  const url = typeof path === "string" && path.startsWith("/") && !path.startsWith("//") ? apiUrl(path) : null;
  if (!url || url.pathname === "/graphql") throw new GitHubTransportError("invalid_request");
  return url;
}

function appKey(privateKey: string) {
  try {
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= 2_048) return key;
  } catch {
    // Keep provider credentials out of configuration errors.
  }
  throw new GitHubTransportError("invalid_request");
}

function scopeFor({ installationId, repositoryIds, permissions }: GitHubInstallationScope): ScopedInstallation {
  const parsed = installationPermissions.safeParse(permissions);
  if (!positiveId(installationId) || !Array.isArray(repositoryIds) || !repositoryIds.length || repositoryIds.length > 500 ||
    !repositoryIds.every(positiveId) || !parsed.success) throw new GitHubTransportError("invalid_request");
  const ids = [...new Set(repositoryIds)].sort((left, right) => left - right);
  const grants = Object.entries(parsed.data).filter(([, permission]) => permission !== undefined);
  if (!grants.length) throw new GitHubTransportError("invalid_request");
  return { installationId, repositoryIds: ids, permissions: Object.fromEntries(grants), cacheKey: JSON.stringify([installationId, ids, grants]) };
}

function installationPath(url: URL, scope: ScopedInstallation, method: GitHubRequestOptions["method"] = "GET") {
  const named = namedRepositoryPath.exec(url.pathname);
  const numeric = numberedRepositoryPath.exec(url.pathname);
  if (!named && (!numeric || !scope.repositoryIds.includes(Number(numeric[1])))) {
    throw new GitHubTransportError("invalid_request");
  }
  if (method === "GET") return;
  const endpoint = named?.[1] ?? numeric?.[2] ?? "";
  const writesCheck = (method === "POST" && endpoint === "/check-runs") ||
    (method === "PATCH" && /^\/check-runs\/[1-9]\d*$/u.test(endpoint));
  if (!writesCheck || scope.permissions.checks !== "write") throw new GitHubTransportError("invalid_request");
}

function cancel(body: ReadableStream | null) {
  if (body) void body.cancel().catch(() => undefined);
}

async function readJson(response: Response, signal: AbortSignal, limit = responseBytes): Promise<unknown> {
  if ((response.status === 204 || response.status === 205) && !response.body) return null;
  const body = response.body;
  const length = response.headers.get("content-length");
  if (!body || (length !== null && (!/^\d+$/u.test(length) || Number(length) > limit))) {
    cancel(body);
    throw new GitHubTransportError("invalid_response", response.status);
  }
  const reader = body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit || chunks.length >= 65_536) throw new GitHubTransportError("invalid_response", response.status);
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
    return JSON.parse(text) as unknown;
  } catch (error) {
    abort();
    if (signal.aborted) throw new GitHubTransportError("provider_unavailable");
    if (error instanceof GitHubTransportError) throw error;
    throw new GitHubTransportError("invalid_response", response.status);
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

function retryDelay(headers: Headers, now: number) {
  const retry = headers.get("retry-after");
  const reset = headers.get("x-ratelimit-reset");
  const seconds = retry && /^\d+$/u.test(retry) ? Number(retry)
    : retry ? Math.ceil((Date.parse(retry) - now) / 1_000)
      : reset && /^\d+$/u.test(reset) ? Math.ceil(Number(reset) - now / 1_000) : NaN;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60;
}

async function httpError(response: Response, signal: AbortSignal, now: number) {
  const { status, headers } = response;
  const rateHeader = headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after");
  if (status === 403 && !rateHeader) {
    const body = await readJson(response, signal, 16 * 1024).catch(() => null);
    if (record(body) && typeof body.message === "string" && /secondary rate limit/iu.test(body.message)) {
      return new GitHubTransportError("rate_limited", status, retryDelay(headers, now));
    }
  } else {
    cancel(response.body);
  }
  if (status === 429 || (status === 403 && rateHeader)) return new GitHubTransportError("rate_limited", status, retryDelay(headers, now));
  if (status === 401) return new GitHubTransportError("unauthenticated", status);
  if (status === 403) return new GitHubTransportError("forbidden", status);
  if (status === 404) return new GitHubTransportError("not_found", status);
  if (status === 409 || status === 412) return new GitHubTransportError("conflict", status);
  if (status === 400 || status === 422) return new GitHubTransportError("validation", status);
  if (status >= 500 || status === 408) return new GitHubTransportError("provider_unavailable", status);
  return new GitHubTransportError("invalid_response", status);
}

function nextLink(headers: Headers, url: URL) {
  const links = headers.get("link");
  if (!links) return null;
  if (links.length > 16_384) throw new GitHubTransportError("pagination_limit");
  let next: URL | null = null;
  for (const link of links.split(/,\s*(?=<)/u)) {
    const pair = /^\s*<([^<>]+)>\s*(.*)$/u.exec(link);
    const relations = pair && /(?:^|;)\s*rel\s*=\s*(?:"([^"]+)"|([^\s;]+))(?=\s*(?:;|$))/iu.exec(pair[2]!);
    if (!pair || !relations) throw new GitHubTransportError("invalid_response");
    if (!(relations[1] ?? relations[2])!.toLowerCase().split(/\s+/u).includes("next")) continue;
    const target = apiUrl(pair[1]!, url);
    if (!target || next) throw new GitHubTransportError("invalid_response");
    next = target;
  }
  return next;
}

function stableParameters(url: URL) {
  const filters = new URLSearchParams([...url.searchParams].filter(([name]) => !pagingParameters.has(name)));
  filters.sort();
  return filters.toString();
}

async function readPages(first: URL, options: GitHubPageOptions, read: ReadPage) {
  const { key, maxPages = 25, maxItems = 2_500, repositoryId, signal: callerSignal } = options;
  if (!positiveId(maxPages) || maxPages > 50 || !positiveId(maxItems) || maxItems > 5_000 ||
    (key !== undefined && !/^[a-z][a-z0-9_]{0,63}$/u.test(key)) ||
    (repositoryId !== undefined && !positiveId(repositoryId))) throw new GitHubTransportError("invalid_request");
  const repoMatch = namedRepositoryPath.exec(first.pathname);
  const alias = repositoryId && repoMatch ? "/repositories/" + repositoryId + (repoMatch[1] ?? "") : null;
  const filters = stableParameters(first);
  const timeout = AbortSignal.timeout(60_000);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  const seen = new Set<string>();
  const items: unknown[] = [];
  let next: URL | null = first;
  while (next) {
    if (seen.size >= maxPages) throw new GitHubTransportError("pagination_limit");
    if ((next.pathname !== first.pathname && next.pathname !== alias) || stableParameters(next) !== filters) {
      throw new GitHubTransportError("invalid_response");
    }
    const canonical = new URL(next);
    canonical.searchParams.sort();
    if (seen.has(canonical.href)) throw new GitHubTransportError("invalid_response");
    seen.add(canonical.href);
    const { data, headers } = await read(next, signal);
    const page = key === undefined ? data : record(data) && Object.hasOwn(data, key) ? data[key] : undefined;
    if (!Array.isArray(page)) throw new GitHubTransportError("invalid_response");
    if (items.length + page.length > maxItems) throw new GitHubTransportError("pagination_limit");
    for (const item of page) items.push(item);
    next = nextLink(headers, next);
  }
  return items;
}

export function createGitHubAppTransport(options: GitHubAppTransportOptions): GitHubAppTransport {
  const appId = Number(options.appId);
  const issuer = options.clientId ?? options.appId;
  if (!positiveId(appId) || !/^[1-9]\d*$/u.test(options.appId) || !/^[A-Za-z0-9_.-]{1,128}$/u.test(issuer)) {
    throw new GitHubTransportError("invalid_request");
  }
  const key = appKey(options.privateKey);
  const fetchApi = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, Token>();
  const pending = new Map<string, Promise<Token>>();
  const methods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

  function appJwt() {
    const second = Math.floor(now() / 1_000);
    const claims = { iat: second - 60, exp: second + 540, iss: issuer };
    const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url");
    const payload = encode({ alg: "RS256", typ: "JWT" }) + "." + encode(claims);
    return payload + "." + sign("RSA-SHA256", Buffer.from(payload), key).toString("base64url");
  }

  async function request(url: URL, token: string, { method = "GET", body, signal: callerSignal }: GitHubRequestOptions = {}): Promise<Reply> {
    if (!credential(token)) throw new GitHubTransportError("unauthenticated");
    if (!methods.has(method) || (method === "GET" && body !== undefined)) throw new GitHubTransportError("invalid_request");
    const headers = new Headers({ Authorization: "Bearer " + token, "User-Agent": "Nutshell" });
    if (url.pathname === "/graphql") {
      headers.set("Accept", "application/json");
    } else {
      headers.set("Accept", "application/vnd.github+json");
      headers.set("X-GitHub-Api-Version", restApiVersion);
    }
    let raw: string | undefined;
    if (body !== undefined) {
      try {
        raw = JSON.stringify(body);
      } catch {
        throw new GitHubTransportError("invalid_request");
      }
      if (!raw || Buffer.byteLength(raw) > responseBytes) throw new GitHubTransportError("invalid_request");
      headers.set("Content-Type", "application/json");
    }
    const timeout = AbortSignal.timeout(requestTimeout);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    let response: Response;
    try {
      signal.throwIfAborted();
      response = await fetchApi(url, { method, body: raw, headers, signal, redirect: "error", cache: "no-store" });
      signal.throwIfAborted();
    } catch {
      throw new GitHubTransportError("provider_unavailable");
    }
    if (response.redirected || (response.url && response.url !== url.href) || (response.status >= 300 && response.status < 400)) {
      cancel(response.body);
      throw new GitHubTransportError("invalid_response", response.status);
    }
    if (!response.ok) throw await httpError(response, signal, now());
    return { data: await readJson(response, signal), headers: response.headers };
  }

  async function mint(scope: ScopedInstallation): Promise<Token> {
    const path = "/app/installations/" + scope.installationId + "/access_tokens";
    const { data } = await request(restUrl(path), appJwt(), {
      method: "POST", body: { repository_ids: scope.repositoryIds, permissions: scope.permissions },
    });
    const parsed = installationReply.safeParse(data);
    if (!parsed.success || !credential(parsed.data.token)) throw new GitHubTransportError("invalid_response");
    const mintedAt = now();
    const expiresAt = Date.parse(parsed.data.expires_at);
    const allowed = parsed.data.repositories.map(({ id }) => id).sort((left, right) => left - right);
    const exactRepositories = allowed.length === scope.repositoryIds.length && allowed.every((id, index) => id === scope.repositoryIds[index]);
    const actual = parsed.data.permissions;
    const exactPermissions = Object.entries(scope.permissions).every(([name, level]) => actual[name as keyof typeof actual] === level) &&
      Object.entries(actual).every(([name, level]) => (name === "metadata" && level === "read") || scope.permissions[name as keyof typeof actual] === level);
    if (!exactRepositories || !exactPermissions || !Number.isFinite(expiresAt) || expiresAt <= mintedAt || expiresAt - mintedAt > 65 * 60_000) {
      throw new GitHubTransportError("invalid_response");
    }
    return { value: parsed.data.token, expiresAt, mintedAt };
  }

  async function installationToken(scope: ScopedInstallation) {
    const { cacheKey } = scope;
    const cached = cache.get(cacheKey);
    const current = now();
    if (cached && current >= cached.mintedAt && cached.expiresAt - current > tokenRefreshWindow) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return cached;
    }
    cache.delete(cacheKey);
    const flight = pending.get(cacheKey);
    if (flight) return flight;
    if (pending.size >= maxInstallationScopes) throw new GitHubTransportError("provider_unavailable");
    const next = mint(scope).then((token) => {
      if (cache.size >= maxInstallationScopes) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, token);
      return token;
    }).finally(() => {
      pending.delete(cacheKey);
    });
    pending.set(cacheKey, next);
    return next;
  }

  async function installed(scope: ScopedInstallation, url: URL, options?: GitHubRequestOptions): Promise<Reply> {
    installationPath(url, scope, options?.method);
    if (options?.signal?.aborted) throw new GitHubTransportError("provider_unavailable");
    const token = await installationToken(scope);
    try {
      return await request(url, token.value, options);
    } catch (error) {
      if (error instanceof GitHubTransportError && error.code === "unauthenticated" && cache.get(scope.cacheKey) === token) {
        cache.delete(scope.cacheKey);
      }
      throw error;
    }
  }

  return {
    appId,
    async appRequest(path, requestOptions) {
      const url = restUrl(path);
      if (!appReadEndpoint.test(url.pathname) || (requestOptions?.method !== undefined && requestOptions.method !== "GET")) {
        throw new GitHubTransportError("invalid_request");
      }
      return (await request(url, appJwt(), requestOptions)).data;
    },
    async userRequest(userToken, path, requestOptions) {
      return (await request(restUrl(path), userToken, requestOptions)).data;
    },
    async userGraphql(userToken, query, variables, signal) {
      if (typeof query !== "string" || !query.trim() || query.length > 32_768) throw new GitHubTransportError("invalid_request");
      const { data, headers } = await request(graphUrl, userToken, { method: "POST", body: { query, variables }, signal });
      if (!record(data) || (data.errors !== undefined && !Array.isArray(data.errors))) throw new GitHubTransportError("invalid_response", 200);
      if (Array.isArray(data.errors) && data.errors.length) {
        const codes = data.errors.flatMap((error) => record(error) && typeof error.type === "string" ? [error.type] : []);
        if (codes.includes("RATE_LIMITED") || headers.get("x-ratelimit-remaining") === "0") {
          throw new GitHubTransportError("rate_limited", 200, retryDelay(headers, now()));
        }
        if (codes.includes("UNAUTHORIZED")) throw new GitHubTransportError("unauthenticated", 200);
        if (codes.includes("FORBIDDEN")) throw new GitHubTransportError("forbidden", 200);
        if (codes.includes("NOT_FOUND")) throw new GitHubTransportError("not_found", 200);
        if (codes.includes("STALE_DATA") || codes.includes("CONFLICT")) throw new GitHubTransportError("conflict", 200);
        throw new GitHubTransportError("validation", 200);
      }
      if (!record(data.data)) throw new GitHubTransportError("invalid_response", 200);
      return data.data;
    },
    async installationRequest(scope, path, requestOptions) {
      return (await installed(scopeFor(scope), restUrl(path), requestOptions)).data;
    },
    async userPages(userToken, path, pageOptions = {}) {
      return readPages(restUrl(path), pageOptions, (url, signal) => request(url, userToken, { signal }));
    },
    async installationPages(scope, path, pageOptions = {}) {
      const normalized = scopeFor(scope);
      return readPages(restUrl(path), pageOptions, (url, signal) => installed(normalized, url, { signal }));
    },
  };
}
