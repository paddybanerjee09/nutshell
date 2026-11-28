import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { loadConfig, readGitHubSetup, openGitHubSetup } = vi.hoisted(() => ({
  loadConfig: vi.fn(), readGitHubSetup: vi.fn(), openGitHubSetup: vi.fn(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/runtime", () => ({ readGitHubSetup, openGitHubSetup }));

const origin = "https://nutshell.example";
const url = origin + "/api/repos/42/github-setup";
const context = { params: Promise.resolve({ repositoryId: "42" }) };
const sourceRevision = "a".repeat(40);
const cookie = "session=opaque";

function post(body: string, requestOrigin = origin, contentType = "application/json") {
  return new Request(url, { method: "POST", body, headers: { origin: requestOrigin, "content-type": contentType, cookie } });
}

beforeEach(() => {
  vi.resetAllMocks();
  loadConfig.mockReturnValue({ mode: "live", origin });
});

describe("live repository setup route", () => {
  it("returns provider-observed status privately using the session and exact path scope", async () => {
    const ready = { status: "ready", canConfigure: false, sourceRevision };
    readGitHubSetup.mockResolvedValueOnce(ready);
    const request = new Request(url, { headers: { cookie } });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(ready);
    expect(readGitHubSetup).toHaveBeenCalledWith(request.headers, "42");
    expect(openGitHubSetup).not.toHaveBeenCalled();
  });

  it("accepts only an exact observed revision and reports a stale source without a merge action", async () => {
    const stale = { status: "stale", sourceRevision: "b".repeat(40) };
    openGitHubSetup.mockResolvedValueOnce(stale);
    const request = post(JSON.stringify({ sourceRevision }));
    const response = await POST(request, context);
    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(stale);
    expect(openGitHubSetup).toHaveBeenCalledExactlyOnceWith(request.headers, "42", sourceRevision);
    expect(readGitHubSetup).not.toHaveBeenCalled();
  });

  it("checks mode, origin, media type, body size, and the exact request before invoking the runtime", async () => {
    const body = JSON.stringify({ sourceRevision });
    loadConfig.mockReturnValueOnce({ mode: "local-alpha", origin });
    expect((await GET(new Request(url), context)).status).toBe(404);
    loadConfig.mockReturnValueOnce({ mode: "local-alpha", origin });
    expect((await POST(post(body), context)).status).toBe(404);
    expect((await POST(post(body, "https://unrelated.example"), context)).status).toBe(403);
    expect((await POST(new Request(url, { method: "POST", body }), context)).status).toBe(403);
    expect((await POST(post(body, origin, "text/plain"), context)).status).toBe(415);
    expect((await POST(post("x".repeat(257)), context)).status).toBe(413);
    expect((await POST(post("{"), context)).status).toBe(400);
    expect((await POST(post(JSON.stringify({ sourceRevision: "main" })), context)).status).toBe(400);
    expect((await POST(post(JSON.stringify({ sourceRevision, merge: true })), context)).status).toBe(400);
    expect(readGitHubSetup).not.toHaveBeenCalled();
    expect(openGitHubSetup).not.toHaveBeenCalled();
  });

  it("keeps runtime errors private and preserves an authorization denial", async () => {
    readGitHubSetup.mockRejectedValueOnce(new Error("private context"));
    const failed = await GET(new Request(url), context);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "unavailable" });
    openGitHubSetup.mockResolvedValueOnce({ status: "forbidden" });
    expect((await POST(post(JSON.stringify({ sourceRevision })), context)).status).toBe(403);
  });
});
