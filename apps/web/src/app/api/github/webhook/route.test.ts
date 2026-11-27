import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@nutshell/server/config";
import { acceptFixtureDelivery } from "@nutshell/server/fixture-sync";
import { POST } from "./route.ts";

vi.mock("@nutshell/server/config", () => ({ loadConfig: vi.fn() }));
vi.mock("@nutshell/server/fixture-sync", () => ({ acceptFixtureDelivery: vi.fn() }));

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

function sign(body: string) {
  return "sha256=" + createHmac("sha256", config.webhookSecret).update(body).digest("hex");
}

function request(body: string | ReadableStream<Uint8Array<ArrayBuffer>>, signature: string) {
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": "push",
      "X-GitHub-Delivery": deliveryId.toUpperCase(),
      "X-Hub-Signature-256": signature,
    },
    body,
    duplex: "half",
  } as const;
  return new Request(config.origin + "/api/github/webhook", init);
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
});
