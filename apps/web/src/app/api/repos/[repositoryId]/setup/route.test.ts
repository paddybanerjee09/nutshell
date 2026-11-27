import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const services = vi.hoisted(() => ({ read: vi.fn(), open: vi.fn(), merge: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({
  loadConfig: () => ({ mode: "local-alpha", deployment: "local", origin: "http://127.0.0.1:3000", webhookSecret: "a".repeat(32) }),
}));
vi.mock("@nutshell/server/fixture-onboarding", () => ({
  readFixtureOnboarding: services.read, openFixtureSetup: services.open, simulateFixtureSetupMerge: services.merge,
}));

const origin = "http://127.0.0.1:3000";
const endpoint = origin + "/api/repos/1001/setup";
const params = { params: Promise.resolve({ repositoryId: "1001" }) };
const head = "1".repeat(40);
const merge = "2".repeat(40);

function request(body: object, requestOrigin = origin) {
  return new Request(endpoint, {
    method: "POST", headers: { origin: requestOrigin, "content-type": "application/json", cookie: "test-session=1" },
    body: JSON.stringify(body),
  });
}

describe("local fixture setup HTTP route", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("rejects requests from other origins and unexpected action fields before opening a proposal", async () => {
    expect((await POST(request({ action: "open" }, "https://untrusted.invalid"), params)).status).toBe(403);
    expect((await POST(request({ action: "open", repositoryId: 1002 }), params)).status).toBe(400);
    expect((await POST(request({ action: "merge", expectedHead: "short" }), params)).status).toBe(400);
    expect((await POST(request({ action: "open", padding: "0".repeat(600) }), params)).status).toBe(413);
    expect(services.open).not.toHaveBeenCalled();
    expect(services.merge).not.toHaveBeenCalled();
  });

  it("uses the repository authorization result and makes successful private reads non-cacheable", async () => {
    services.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ canConfigure: false, configured: false, proposal: null });
    services.open.mockResolvedValue({ status: "forbidden" });
    expect((await GET(new Request(endpoint), params)).status).toBe(404);
    const response = await GET(new Request(endpoint), params);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ canConfigure: false });
    expect((await POST(request({ action: "open" }), params)).status).toBe(403);
    expect(services.open).toHaveBeenCalledWith(expect.any(Headers), "1001");
  });

  it("signs the stored simulated merge delivery over exact bytes and repeats it after a transport failure", async () => {
    const delivery = { deliveryId: "cfc0247b-1171-4346-a30e-293e589c170f", repositoryId: 1001, installationId: 2001, revision: merge };
    const proposal = { status: "merged", headRevision: head, mergeRevision: merge };
    services.merge.mockResolvedValue({ status: "merged", proposal, delivery });
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new Error("loopback unavailable"))
      .mockResolvedValueOnce(Response.json({ status: "duplicate" }, { status: 202 }));
    vi.stubGlobal("fetch", dispatch);

    const first = await POST(request({ action: "merge", expectedHead: head }), params);
    expect(first.status).toBe(502);
    expect(await first.json()).toEqual({ status: "delivery_pending" });
    const second = await POST(request({ action: "merge", expectedHead: head }), params);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "merged", proposal });
    expect(services.merge).toHaveBeenCalledWith(expect.any(Headers), "1001", head);

    const [url, options] = dispatch.mock.calls[0]!;
    expect(url).toBe(origin + "/api/github/webhook");
    expect(options.redirect).toBe("error");
    expect(options.headers).toEqual({
      "content-type": "application/json", "x-github-event": "push", "x-github-delivery": delivery.deliveryId,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", "a".repeat(32)).update(options.body).digest("hex"),
    });
    expect(JSON.parse(options.body)).toEqual({ ref: "refs/heads/main", after: merge, repository: { id: 1001 }, installation: { id: 2001 } });
    expect(dispatch.mock.calls[1]?.[1]).toMatchObject({ headers: options.headers, body: options.body });
  });
});
