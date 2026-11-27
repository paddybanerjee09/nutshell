import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const services = vi.hoisted(() => ({ config: vi.fn(), read: vi.fn(), propose: vi.fn(), merge: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({ loadConfig: services.config }));
vi.mock("@nutshell/server/fixture-draft-proposals", () => ({
  readFixtureDraftProposal: services.read, proposeFixtureDraft: services.propose, mergeFixtureDraftProposal: services.merge,
}));

const origin = "http://127.0.0.1:3000";
const endpoint = origin + "/api/repos/1001/draft-proposal";
const params = { params: Promise.resolve({ repositoryId: "1001" }) };
const path = "nutshell-vault/features/a note.md";
const expectedHead = "1".repeat(64);
const proposalId = "0b945c41-122d-4a30-875b-831f028ce1bf";
const merge = { action: "merge", path, proposalId, expectedHead };

function request(body: object, requestOrigin = origin, contentType = "application/json") {
  return new Request(endpoint, {
    method: "POST", headers: { origin: requestOrigin, "content-type": contentType, cookie: "test-session=1" },
    body: JSON.stringify(body),
  });
}

describe("local draft proposal HTTP route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.config.mockReturnValue({ mode: "local-alpha", deployment: "local", origin, webhookSecret: "a".repeat(32) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("checks local mode, same-origin mutations, JSON shape, and request limits before accessing proposals", async () => {
    services.config.mockReturnValueOnce({ mode: "live", deployment: "local" });
    expect((await GET(new Request(endpoint + "?path=" + encodeURIComponent(path)), params)).status).toBe(404);
    expect((await POST(request(merge, "https://untrusted.invalid"), params)).status).toBe(403);
    expect((await POST(request(merge, origin, "text/plain"), params)).status).toBe(415);
    expect((await POST(request({ ...merge, expectedHead: "invalid" }), params)).status).toBe(400);
    expect((await POST(request({ ...merge, revision: expectedHead }), params)).status).toBe(400);
    expect((await POST(request({ action: "propose", path, version: 0 }), params)).status).toBe(400);
    expect((await POST(request({ ...merge, extra: "0".repeat(4_000) }), params)).status).toBe(413);
    expect((await GET(new Request(endpoint + "?path=a&path=b"), params)).status).toBe(400);
    expect(services.read).not.toHaveBeenCalled();
    expect(services.propose).not.toHaveBeenCalled();
    expect(services.merge).not.toHaveBeenCalled();
  });

  it("returns private authorized reads and distinguishes an invalid candidate from a revision conflict", async () => {
    services.read.mockResolvedValueOnce({ status: "ready", proposal: null }).mockResolvedValueOnce({ status: "unavailable" });
    const url = endpoint + "?path=" + encodeURIComponent(path);
    const response = await GET(new Request(url, { headers: { cookie: "test-session=1" } }), params);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ status: "ready", proposal: null });
    expect(services.read).toHaveBeenCalledWith(expect.any(Headers), "1001", path);
    expect((await GET(new Request(url), params)).status).toBe(404);

    const conflict = {
      status: "conflict", reason: "version", proposal: null, currentRevision: expectedHead,
      draft: { path, version: 3, markdown: "The author's saved text." },
    };
    const invalid = { status: "invalid_candidate", issues: [{ path, code: "note-metadata", message: "Invalid status field." }] };
    services.propose.mockResolvedValueOnce(conflict).mockResolvedValueOnce(invalid);
    const propose = { action: "propose", path, version: 2 };
    const first = await POST(request(propose), params);
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual(conflict);
    const second = await POST(request({ ...propose, expectedHead }), params);
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual(invalid);
    expect(services.propose).toHaveBeenLastCalledWith(expect.any(Headers), "1001", { path, version: 2, expectedHead });
  });

  it("replays the same signed delivery and reports pending instead of indexed on transport failure", async () => {
    const revision = "2".repeat(64);
    const proposal = { id: proposalId, provider: "fixture", status: "merged", headRevision: expectedHead, mergeRevision: revision };
    const delivery = { deliveryId: "cfc0247b-1171-4346-a30e-293e589c170f", repositoryId: 1001, installationId: 2001, revision };
    services.merge.mockResolvedValue({ status: "merged", proposal, delivery });
    const dispatch = vi.fn()
      .mockRejectedValueOnce(new Error("loopback unavailable"))
      .mockResolvedValueOnce(Response.json({ status: "duplicate" }, { status: 202 }));
    vi.stubGlobal("fetch", dispatch);

    const first = await POST(request(merge), params);
    expect(first.status).toBe(502);
    expect(await first.json()).toEqual({ status: "delivery_pending", proposal });
    const second = await POST(request(merge), params);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "merged", proposal });
    expect(services.merge).toHaveBeenLastCalledWith(expect.any(Headers), "1001", { path, proposalId, expectedHead });
    const [url, signed] = dispatch.mock.calls[0]!;
    expect(url).toBe(origin + "/api/github/webhook");
    expect(signed.headers).toMatchObject({ "x-github-delivery": delivery.deliveryId, "x-hub-signature-256": expect.stringMatching(/^sha256=[a-f0-9]{64}$/u) });
    expect(dispatch.mock.calls[1]?.[1]).toMatchObject({ headers: signed.headers, body: signed.body });
  });
});
