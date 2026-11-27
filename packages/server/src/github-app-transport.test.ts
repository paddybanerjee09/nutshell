import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubAppTransport, GitHubTransportError, type GitHubInstallationScope } from "./github-app-transport.ts";

const time = Date.UTC(2026, 10, 27, 12, 0, 0);
const appId = "91";
const clientId = "Iv1.fixture-client";
const userToken = "ghu_fixture-user";
const origin = "https://api.github.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const contentsScope = { installationId: 22, repositoryIds: [31], permissions: { contents: "read" } } satisfies GitHubInstallationScope;
const checksScope = { ...contentsScope, permissions: { checks: "write" } } satisfies GitHubInstallationScope;

type Call = { url: URL; init: RequestInit; headers: Headers };

function controlled(send: (call: Call) => Response | Promise<Response>, now = () => time) {
  const calls: Call[] = [];
  const transport = createGitHubAppTransport({
    appId, clientId, privateKey: pem, now,
    fetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const call = { url, init, headers: new Headers(init.headers) };
      calls.push(call);
      return send(call);
    },
  });
  return { transport, calls };
}

function payload(call: Call) {
  return JSON.parse(String(call.init.body)) as unknown;
}

function mintReply(body: { repository_ids: number[]; permissions: Record<string, string> }, token: string, clock = time) {
  return Response.json({
    token, expires_at: new Date(clock + 3_600_000).toISOString(), permissions: { metadata: "read", ...body.permissions },
    repository_selection: "selected", repositories: body.repository_ids.map((id) => ({ id })),
  }, { status: 201 });
}

describe("GitHub App transport with controlled provider responses", () => {
  it("uses a fixed API host and never changes authority after a denied user request", async () => {
    const { transport, calls } = controlled(({ url }) => url.pathname === "/user"
      ? Response.json({ login: "fixture" })
      : Response.json({ message: "a provider response with " + userToken }, { status: 403 }));

    expect(transport.appId).toBe(91);
    expect(await transport.userRequest(userToken, "/user")).toEqual({ login: "fixture" });
    const denial = await transport.userRequest(userToken, "/repos/fixture/alpha").catch((error: unknown) => error);
    expect(denial).toBeInstanceOf(GitHubTransportError);
    expect(denial).toMatchObject({ code: "forbidden", status: 403 });
    expect(JSON.stringify(denial)).not.toContain(userToken);
    for (const path of ["https://other.example/user", "//other.example/user", "/a/../user", "/a/%2E%2E/user", "/\\other.example", "/user#private"]) {
      await expect(transport.userRequest(userToken, path)).rejects.toMatchObject({ code: "invalid_request" });
    }
    await expect(transport.userRequest("value\r\nfake: header", "/user")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(transport.appRequest("/app/installations/22/access_tokens", { method: "POST" })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(transport.installationRequest(checksScope, "/repos/fixture/alpha/pulls", { method: "POST", body: {} }))
      .rejects.toMatchObject({ code: "invalid_request" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.origin).toBe(origin);
      expect(call.headers.get("authorization")).toBe("Bearer " + userToken);
      expect(call.headers.get("x-github-api-version")).toBe("2026-03-10");
      expect(call.init).toMatchObject({ redirect: "error", cache: "no-store" });
    }
  });

  it("normalizes redirect, malformed and oversized response errors without forwarding response text", async () => {
    let canceled = false;
    const oversized = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() { canceled = true; },
    });
    const responses = [
      Response.redirect("https://other.example/user"),
      new Response("unexpected HTML with " + userToken),
      new Response(null, { status: 200, headers: { "content-length": "9000000" } }),
      new Response(oversized),
    ];
    const { transport, calls } = controlled(() => responses.shift()!);
    for (let index = 0; index < 4; index++) {
      const failure = await transport.userRequest(userToken, "/user").catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "invalid_response" });
      expect(String(failure)).not.toContain(userToken);
    }
    expect(calls).toHaveLength(4);
    expect(canceled).toBe(true);
  });

  it("classifies primary and secondary limits and discards partial GraphQL results", async () => {
    const responses = [
      Response.json({}, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(time / 1_000 + 29) } }),
      Response.json({ message: "You have exceeded a secondary rate limit." }, { status: 403 }),
      Response.json({}, { status: 429, headers: { "Retry-After": "12" } }),
      Response.json({ data: { repository: { id: "fixture" } } }),
      Response.json({ data: { partial: "untrusted" }, errors: [{ type: "FORBIDDEN", message: userToken }] }),
      Response.json({ data: { commit: null }, errors: [{ type: "STALE_DATA" }] }),
    ];
    const { transport, calls } = controlled(() => responses.shift()!);
    for (const retryAfterSeconds of [29, 60, 12]) {
      await expect(transport.userRequest(userToken, "/user")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds });
    }
    await expect(transport.userGraphql(userToken, "query { repository { id } }", { repository: "fixture" }))
      .resolves.toEqual({ repository: { id: "fixture" } });
    await expect(transport.userGraphql(userToken, "query { repository { id } }")).rejects.toMatchObject({ code: "forbidden", status: 200 });
    await expect(transport.userGraphql(userToken, "mutation { createCommitOnBranch { commit { oid } } }"))
      .rejects.toMatchObject({ code: "conflict", status: 200 });
    expect(calls.slice(3).map(({ url }) => url.href)).toEqual(Array(3).fill(origin + "/graphql"));
    expect(payload(calls[3]!)).toMatchObject({ variables: { repository: "fixture" } });
  });

  it("reads a complete bounded Link chain with the same endpoint, filters and bearer token", async () => {
    const path = "/repos/fixture/alpha/check-runs";
    const responses = [
      Response.json({ check_runs: [{ id: 1 }] }, { headers: {
        link: '<' + origin + '/repositories/31/check-runs?page=2&filter=latest>; rel="next", <' + origin +
          '/repositories/31/check-runs?page=2&filter=latest>; rel="last"',
      } }),
      Response.json({ check_runs: [{ id: 2 }] }),
    ];
    const { transport, calls } = controlled(() => responses.shift()!);
    expect(await transport.userPages(userToken, path + "?filter=latest", { key: "check_runs", repositoryId: 31 })).toEqual([{ id: 1 }, { id: 2 }]);
    expect(calls.map(({ url }) => url.pathname)).toEqual([path, "/repositories/31/check-runs"]);
    expect(calls.every(({ headers }) => headers.get("authorization") === "Bearer " + userToken)).toBe(true);
  });

  it("fails closed on pagination loops, cross-target links, malformed envelopes and truncation", async () => {
    for (const [next, settings, errorCode] of [
      ["/user/installations/22/repositories", {}, "invalid_response"],
      ["https://lookalike.example/user/installations/22/repositories", {}, "invalid_response"],
      ["/user/installations/23/repositories?page=2", {}, "invalid_response"],
      ["/user/installations/22/repositories?page=2&filter=all", {}, "invalid_response"],
      ["/user/installations/22/repositories?page=2", { maxPages: 1 }, "pagination_limit"],
      ["/user/installations/22/repositories?page=2", { maxItems: 1 }, "pagination_limit"],
    ] as const) {
      const { transport, calls } = controlled(() => Response.json({ repositories: [{ id: 1 }, { id: 2 }] }, {
        headers: { link: "<" + next + '>; rel="next"' },
      }));
      await expect(transport.userPages(userToken, "/user/installations/22/repositories", { key: "repositories", ...settings }))
        .rejects.toMatchObject({ code: errorCode });
      expect(calls).toHaveLength(1);
    }
    const { transport } = controlled(() => Response.json({ invalid: [] }));
    await expect(transport.userPages(userToken, "/user/installations", { key: "installations" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("signs a short-lived app JWT, scopes each installation token and coalesces exact cache misses", async () => {
    let clock = time;
    let mints = 0;
    const firstToken = "ghs_91_" + "a".repeat(920) + ".fixture.long";
    const { transport, calls } = controlled((call) => {
      if (call.url.pathname.endsWith("/access_tokens")) {
        const body = payload(call) as Parameters<typeof mintReply>[0];
        return mintReply(body, ++mints === 1 ? firstToken : "installation-" + mints, clock);
      }
      return Response.json({ observed: true });
    }, () => clock);
    const route = "/repos/fixture/alpha/git/ref/heads/release%2Fmain";
    await Promise.all([transport.installationRequest(contentsScope, route), transport.installationRequest(contentsScope, route)]);
    expect(calls).toHaveLength(3);
    const mint = calls[0]!;
    expect(mint.url.href).toBe(origin + "/app/installations/22/access_tokens");
    expect(payload(mint)).toEqual({ repository_ids: [31], permissions: { contents: "read" } });
    const [header, claims, signature] = mint.headers.get("authorization")!.slice(7).split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString()))
      .toEqual({ iss: clientId, iat: time / 1_000 - 60, exp: time / 1_000 + 540 });
    expect(verify("RSA-SHA256", Buffer.from(header + "." + claims), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(calls.slice(1).map(({ headers }) => headers.get("authorization"))).toEqual(Array(2).fill("Bearer " + firstToken));

    await transport.installationRequest(contentsScope, route);
    expect(mints).toBe(1);
    await transport.installationRequest(checksScope, "/repos/fixture/alpha/check-runs", { method: "POST", body: { head_sha: "b".repeat(40) } });
    await transport.installationRequest({ ...contentsScope, repositoryIds: [32] }, "/repositories/32/git/ref/heads/main");
    expect(mints).toBe(3);
    clock += 3_550_000;
    await Promise.all([transport.installationRequest(contentsScope, route), transport.installationRequest(contentsScope, route)]);
    expect(mints).toBe(4);
    expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer installation-4");
  });

  it("refuses a widened grant and remints after an exact-scope installation credential is rejected", async () => {
    let mints = 0;
    let denied = false;
    const { transport, calls } = controlled((call) => {
      if (call.url.pathname.endsWith("/access_tokens")) {
        const body = payload(call) as Parameters<typeof mintReply>[0];
        if (++mints === 1) return mintReply({ ...body, repository_ids: [31, 32] }, "wrong-repositories");
        if (mints === 2) return mintReply({ ...body, permissions: { ...body.permissions, checks: "write" } }, "wrong-permissions");
        return mintReply(body, "installation-" + mints);
      }
      if (!denied) {
        denied = true;
        return Response.json({}, { status: 401 });
      }
      return Response.json({ id: 31 });
    });
    const path = "/repositories/31";
    for (let index = 0; index < 2; index++) {
      await expect(transport.installationRequest(contentsScope, path)).rejects.toMatchObject({ code: "invalid_response" });
    }
    expect(calls).toHaveLength(2);
    await expect(transport.installationRequest(contentsScope, "/repositories/32")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(transport.installationRequest(contentsScope, path)).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    expect(mints).toBe(3);
    await expect(transport.installationRequest(contentsScope, path)).resolves.toEqual({ id: 31 });
    expect(mints).toBe(4);
  });

  it("cancels an in-flight body read and makes no request for an already-aborted caller", async () => {
    let canceled = false;
    const controller = new AbortController();
    const body = new ReadableStream({ cancel() { canceled = true; } });
    const { transport, calls } = controlled(() => {
      setTimeout(() => controller.abort(), 0);
      return new Response(body);
    });
    await expect(transport.userRequest(userToken, "/user", { signal: controller.signal }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    expect(canceled).toBe(true);
    await expect(transport.userRequest(userToken, "/user", { signal: controller.signal }))
      .rejects.toMatchObject({ code: "provider_unavailable" });
    expect(calls).toHaveLength(1);
  });
});
