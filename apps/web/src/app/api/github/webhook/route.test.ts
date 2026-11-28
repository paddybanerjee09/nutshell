import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@nutshell/server/config";
import { acceptFixtureDelivery } from "@nutshell/server/fixture-sync";
import { acceptLiveRevocation } from "@nutshell/server/github-live-revocation";
import { acceptLivePush } from "@nutshell/server/github-live-sync";
import { POST } from "./route.ts";

vi.mock("@nutshell/server/config", () => ({ loadConfig: vi.fn() }));
vi.mock("@nutshell/server/fixture-sync", () => ({ acceptFixtureDelivery: vi.fn() }));
vi.mock("@nutshell/server/github-live-revocation", () => ({ acceptLiveRevocation: vi.fn() }));
vi.mock("@nutshell/server/github-live-sync", () => ({ acceptLivePush: vi.fn() }));

const config = {
  mode: "local-alpha",
  deployment: "local",
  origin: "http://127.0.0.1:3000",
  databaseUrl: "postgresql://test@127.0.0.1/nutshell_alpha",
  testDatabaseUrl: "postgresql://test@127.0.0.1/nutshell_alpha_test",
  authSecret: "test-only-auth-secret-for-webhook-fixture",
  webhookSecret: "test-only-webhook-secret-for-fixture",
} satisfies ReturnType<typeof loadConfig>;
const deliveryId = "89b399e6-c0e2-425b-b7da-1a09de068550";
const push = {
  ref: "refs/heads/main",
  after: "b".repeat(40),
  repository: { id: 1001, name: "Café" },
  installation: { id: 2001 },
};
const rawPush = JSON.stringify(push, null, 2);

function sign(body: string, secret = config.webhookSecret) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function request(body: string | ReadableStream<Uint8Array<ArrayBuffer>>, signature: string, origin = config.origin, event = "push") {
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-GitHub-Delivery": deliveryId.toUpperCase(),
      "X-Hub-Signature-256": signature,
    },
    body,
    duplex: "half",
  } as const;
  return new Request(origin + "/api/github/webhook", init);
}

describe("fixture webhook ingress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadConfig).mockReturnValue(config);
    vi.mocked(acceptFixtureDelivery).mockResolvedValue("accepted");
  });

  it("verifies the exact UTF-8 payload and normalizes the delivery ID", async () => {
    const response = await POST(request(rawPush, sign(rawPush)));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
    expect(acceptFixtureDelivery).toHaveBeenCalledExactlyOnceWith({
      deliveryId, repositoryId: 1001, installationId: 2001, revision: push.after,
    });
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it("denies changed raw bytes even when their JSON value is identical", async () => {
    const response = await POST(request(JSON.stringify(push), sign(rawPush)));

    expect(response.status).toBe(401);
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("leaves ingress unavailable without a configured webhook secret", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...config, webhookSecret: undefined });
    const response = await POST(request(rawPush, sign(rawPush)));

    expect(response.status).toBe(404);
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("rejects oversized streamed requests without a Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const response = await POST(request(stream, sign(rawPush)));

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("ignores a signed push to another ref", async () => {
    const body = JSON.stringify({ ...push, ref: "refs/heads/experiment" });
    const response = await POST(request(body, sign(body)));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("rejects a signed push with an unsafe numeric repository ID", async () => {
    const body = JSON.stringify({ ...push, repository: { id: Number.MAX_SAFE_INTEGER + 1 } });
    const response = await POST(request(body, sign(body)));

    expect(response.status).toBe(400);
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("ignores live revocation events in fixture mode without parsing their payload", async () => {
    const response = await POST(request("{", sign("{"), config.origin, "installation"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(acceptLiveRevocation).not.toHaveBeenCalled();
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });
});

const liveConfig = {
  mode: "live",
  deployment: "hosted",
  origin: "https://nutshell.example.test",
  databaseUrl: "postgresql://test@127.0.0.1/nutshell_live_test",
  authSecret: "test-only-auth-secret-for-webhook-live",
  githubApp: {
    appId: "12", clientId: "Iv1.controlled", clientSecret: "test-application-secret", privateKey: "test-private-key",
    webhookSecret: "test-only-webhook-secret-for-live-mode",
  },
} satisfies ReturnType<typeof loadConfig>;
const livePush = {
  ref: "refs/heads/release/stable",
  after: "a".repeat(40),
  repository: { id: 59123, owner: { id: 1973, login: "repository-owner" }, node_id: "R_verified", default_branch: "release/stable", name: "Café" },
  installation: { id: 89423 },
  sender: { id: 42, ownerId: 42, installationId: 42, login: "different-sender" },
  pusher: { name: "Not a trusted identity" },
};
const rawLivePush = JSON.stringify(livePush, null, 2);
const liveRequest = (body: string, event = "push") => request(body, sign(body, liveConfig.githubApp.webhookSecret), liveConfig.origin, event);

describe("live webhook ingress", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadConfig).mockReturnValue(liveConfig);
    vi.mocked(acceptLivePush).mockResolvedValue("accepted");
  });

  it("enqueues exactly the signed stable repository identities and non-main default branch", async () => {
    const response = await POST(liveRequest(rawLivePush));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
    expect(acceptLivePush).toHaveBeenCalledExactlyOnceWith({
      deliveryId, repositoryId: livePush.repository.id, ownerId: livePush.repository.owner.id,
      repositoryNodeId: livePush.repository.node_id, installationId: livePush.installation.id, ref: livePush.ref, revision: livePush.after,
    });
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
    expect(acceptLiveRevocation).not.toHaveBeenCalled();
  });

  it("uses only the live secret and verifies the raw bytes before parsing JSON", async () => {
    expect((await POST(request("{", sign("{"), liveConfig.origin))).status).toBe(401);
    expect((await POST(request(JSON.stringify(livePush), sign(rawLivePush, liveConfig.githubApp.webhookSecret), liveConfig.origin))).status).toBe(401);
    expect((await POST(liveRequest("{"))).status).toBe(400);
    expect(acceptLivePush).not.toHaveBeenCalled();
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it.each([
    { ref: "refs/tags/v1" }, { ref: "refs/heads/main" }, { deleted: true }, { after: "0".repeat(40) },
  ])("ignores a signed non-default, deleted or zero-revision push %j", async (edit) => {
    const response = await POST(liveRequest(JSON.stringify({ ...livePush, ...edit })));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it("ignores a verified unsupported event without parsing its payload", async () => {
    const response = await POST(liveRequest("{", "pull_request"));
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it.each([
    { id: 0 }, { owner: { id: Number.MAX_SAFE_INTEGER + 1 } }, { owner: { id: "1973" } }, { owner: undefined },
    { node_id: " " }, { node_id: "a".repeat(257) }, { node_id: "\ud800" },
    { default_branch: "release/../stable" }, { default_branch: "release/stable.lock" }, { default_branch: undefined },
  ])("rejects an invalid signed live repository target %j", async (edit) => {
    const response = await POST(liveRequest(JSON.stringify({ ...livePush, repository: { ...livePush.repository, ...edit } })));
    expect(response.status).toBe(400);
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it("rejects unsafe live push refs and unsafe installation IDs", async () => {
    const ref = JSON.stringify({ ...livePush, ref: "refs/heads/release/../stable" });
    const installation = JSON.stringify({ ...livePush, installation: { id: -1 } });
    expect((await POST(liveRequest(ref))).status).toBe(400);
    expect((await POST(liveRequest(installation))).status).toBe(400);
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it("bounds unknown-length live payloads to one MiB", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const signature = sign(rawLivePush, liveConfig.githubApp.webhookSecret);
    expect((await POST(request(stream, signature, liveConfig.origin))).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(acceptLivePush).not.toHaveBeenCalled();
  });

  it("accepts a valid live push above the fixture body limit", async () => {
    const body = JSON.stringify({ ...livePush, commits: [{ message: "a".repeat(65 * 1024) }] });
    expect((await POST(liveRequest(body))).status).toBe(202);
    expect(acceptLivePush).toHaveBeenCalledOnce();
  });

  it("keeps a retry idempotent and outbox failures private", async () => {
    vi.mocked(acceptLivePush).mockResolvedValueOnce("duplicate").mockResolvedValueOnce("unavailable")
      .mockRejectedValueOnce(new Error("controlled internal details"));
    for (const [statusCode, status] of [[202, "duplicate"], [404, "unavailable"], [503, "unavailable"]]) {
      const response = await POST(liveRequest(rawLivePush));
      expect(response.status).toBe(statusCode);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ status });
    }
  });
});

describe("live webhook revocation ingress", () => {
  const installation = { id: 89423, account: { id: 1973 } };
  const sender = { id: 42, login: "different-sender" };
  const rawRevocation = JSON.stringify({ action: "revoked", sender }, null, 2);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadConfig).mockReturnValue(liveConfig);
    vi.mocked(acceptLiveRevocation).mockResolvedValue("accepted");
  });

  it.each(["suspend", "deleted"])("scopes installation %s to the account on the installation", async (action) => {
    const response = await POST(liveRequest(JSON.stringify({ action, installation, sender, organization: { id: 400 } }), "installation"));

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
    expect(acceptLiveRevocation).toHaveBeenCalledExactlyOnceWith(deliveryId, {
      kind: "installation", installationId: installation.id, ownerId: installation.account.id,
    });
    expect(acceptLivePush).not.toHaveBeenCalled();
    expect(acceptFixtureDelivery).not.toHaveBeenCalled();
  });

  it("passes only the explicitly removed repository IDs, once each", async () => {
    const body = JSON.stringify({
      action: "removed", installation, sender, repository_selection: "selected", repository: { id: 600 },
      repositories_removed: [{ id: 500 }, { id: 600 }, { id: 500 }],
    });
    const response = await POST(liveRequest(body, "installation_repositories"));

    expect(response.status).toBe(202);
    expect(acceptLiveRevocation).toHaveBeenCalledExactlyOnceWith(deliveryId, {
      kind: "repository_selection", installationId: installation.id, ownerId: installation.account.id, repositoryIds: [500, 600],
    });
  });

  it("records an ambiguous change to selected repositories with an empty scope", async () => {
    const body = JSON.stringify({
      action: "removed", installation, sender, repository_selection: "selected",
      repositories_removed: [], repositories_added: [],
    });
    const response = await POST(liveRequest(body, "installation_repositories"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "accepted" });
    expect(acceptLiveRevocation).toHaveBeenCalledExactlyOnceWith(deliveryId, {
      kind: "repository_selection", installationId: installation.id, ownerId: installation.account.id, repositoryIds: [],
    });
  });

  it.each(["deleted", "transferred", "publicized"])("scopes repository %s to its signed repository and installation", async (action) => {
    const body = JSON.stringify({
      action, installation: { id: installation.id }, sender,
      repository: { id: 59123, node_id: "R_verified", owner: { id: 900 } },
      changes: { owner: { from: { user: { id: 950 } } } },
    });
    const response = await POST(liveRequest(body, "repository"));

    expect(response.status).toBe(202);
    expect(acceptLiveRevocation).toHaveBeenCalledExactlyOnceWith(deliveryId, {
      kind: "repository", installationId: installation.id, repositoryId: 59123, repositoryNodeId: "R_verified",
    });
  });

  it("scopes an app authorization revocation to the revoking GitHub user", async () => {
    const response = await POST(liveRequest(rawRevocation, "github_app_authorization"));

    expect(response.status).toBe(202);
    expect(acceptLiveRevocation).toHaveBeenCalledExactlyOnceWith(deliveryId, { kind: "account", githubUserId: sender.id });
  });

  it("checks the live secret, exact bytes, and delivery ID before attempting to revoke", async () => {
    const event = "github_app_authorization";
    const changed = JSON.stringify(JSON.parse(rawRevocation));
    const badDelivery = liveRequest(rawRevocation, event);
    badDelivery.headers.set("x-github-delivery", "invalid");

    expect((await POST(request(rawRevocation, sign(rawRevocation), liveConfig.origin, event))).status).toBe(401);
    expect((await POST(request(changed, sign(rawRevocation, liveConfig.githubApp.webhookSecret), liveConfig.origin, event))).status).toBe(401);
    expect((await POST(badDelivery)).status).toBe(400);
    expect(acceptLiveRevocation).not.toHaveBeenCalled();
  });

  it.each([
    { event: "installation", body: { action: "suspend", installation: { id: 89423 }, sender } },
    { event: "installation", body: { action: "deleted", installation: { ...installation, account: { id: "1973" } } } },
    { event: "installation_repositories", body: { action: "removed", installation, repositories_removed: [{ id: 500 }, { id: Number.MAX_SAFE_INTEGER + 1 }] } },
    { event: "installation_repositories", body: { action: "removed", installation, repository: { id: 500 } } },
    { event: "repository", body: { action: "deleted", installation: { id: 0 }, repository: { id: 59123, node_id: "R_verified" } } },
    { event: "repository", body: { action: "transferred", installation, repository: { id: 59123, node_id: "\u0000R_invalid" } } },
    { event: "github_app_authorization", body: { action: "revoked", installation, sender: { id: "42" } } },
  ])("rejects malformed $event scope before persistence", async ({ event, body }) => {
    const response = await POST(liveRequest(JSON.stringify(body), event));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: "invalid" });
    expect(acceptLiveRevocation).not.toHaveBeenCalled();
  });

  it.each([
    { event: "installation", body: { action: "created", installation } },
    { event: "installation", body: { action: "unsuspend", installation } },
    { event: "installation_repositories", body: { action: "added", installation, repositories_added: [{ id: 500 }] } },
    { event: "installation_repositories", body: { action: "removed", installation, repository_selection: "all", repositories_removed: [] } },
    { event: "repository", body: { action: "transferred", repository: { id: 59123, node_id: "R_verified" } } },
    { event: "repository", body: { action: "privatized", installation, repository: { id: 59123, node_id: "R_verified" } } },
  ])("ignores $event $body.action when there is no explicit revocation target", async ({ event, body }) => {
    const response = await POST(liveRequest(JSON.stringify(body), event));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: "ignored" });
    expect(acceptLiveRevocation).not.toHaveBeenCalled();
  });

  it("preserves duplicate and private failure responses", async () => {
    vi.mocked(acceptLiveRevocation).mockResolvedValueOnce("duplicate").mockResolvedValueOnce("unavailable")
      .mockRejectedValueOnce(new Error("controlled internal details"));

    for (const [statusCode, status] of [[202, "duplicate"], [404, "unavailable"], [503, "unavailable"]]) {
      const response = await POST(liveRequest(rawRevocation, "github_app_authorization"));
      expect(response.status).toBe(statusCode);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ status });
    }
  });
});
