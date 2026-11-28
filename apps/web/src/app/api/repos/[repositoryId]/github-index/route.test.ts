import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const { loadConfig, requestGitHubReconciliation } = vi.hoisted(() => ({
  loadConfig: vi.fn(), requestGitHubReconciliation: vi.fn(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/github-live-sync", () => ({ requestGitHubReconciliation }));

const origin = "https://nutshell.test";
const context = { params: Promise.resolve({ repositoryId: "31" }) };

function post(requestOrigin: string | null = origin, body?: string) {
  const headers = new Headers({ cookie: "session=opaque" });
  if (requestOrigin) headers.set("origin", requestOrigin);
  return new Request(origin + "/api/repos/31/github-index", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetAllMocks();
  loadConfig.mockReturnValue({ mode: "live", origin });
});

describe("authorized live index reconciliation route", () => {
  it("queues the server-observed revision privately, and reports an already current index", async () => {
    const revision = "a".repeat(40);
    const queued = { status: "queued", revision };
    const current = { status: "current", revision };
    const request = post();
    requestGitHubReconciliation.mockResolvedValueOnce(queued).mockResolvedValueOnce(current);
    const accepted = await POST(request, context);
    expect(accepted.status).toBe(202);
    expect(accepted.headers.get("cache-control")).toBe("private, no-store");
    expect(await accepted.json()).toEqual(queued);
    expect(requestGitHubReconciliation).toHaveBeenCalledWith(request.headers, "31");
    const indexed = await POST(post(), context);
    expect(indexed.status).toBe(200);
    expect(await indexed.json()).toEqual(current);
  });

  it("denies fixture mode, other origins, and client-selected revision or repository bodies", async () => {
    loadConfig.mockReturnValueOnce({ mode: "local-alpha", origin });
    expect((await POST(post(), context)).status).toBe(404);
    expect((await POST(post(null), context)).status).toBe(403);
    expect((await POST(post("https://other.test"), context)).status).toBe(403);
    expect((await POST(post(origin, JSON.stringify({ revision: "a".repeat(40), repositoryId: 32 })), context)).status).toBe(400);
    expect(requestGitHubReconciliation).not.toHaveBeenCalled();
  });

  it("preserves administrator denial and keeps runtime errors private", async () => {
    requestGitHubReconciliation.mockResolvedValueOnce({ status: "forbidden" }).mockRejectedValueOnce(new Error("private diagnostic"));
    const denied = await POST(post(), context);
    expect(denied.status).toBe(403);
    const error = await POST(post(), context);
    expect(error.status).toBe(503);
    expect(error.headers.get("cache-control")).toBe("private, no-store");
    expect(await error.json()).toEqual({ status: "unavailable" });
  });
});
