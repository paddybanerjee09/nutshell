import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { loadConfig, readFixtureSnapshot, readGitHubWorkspace } = vi.hoisted(() => ({
  loadConfig: vi.fn(), readFixtureSnapshot: vi.fn(), readGitHubWorkspace: vi.fn(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/fixture-sync", () => ({ readFixtureSnapshot }));
vi.mock("@nutshell/server/runtime", () => ({ readGitHubWorkspace }));

const request = new Request("https://nutshell.test/api/repos/31/snapshot", { headers: { cookie: "session=opaque" } });
const context = { params: Promise.resolve({ repositoryId: "31" }) };

beforeEach(() => vi.resetAllMocks());

describe("private repository snapshot API", () => {
  it("claims only its configured provider and returns the authorized projection without actor metadata", async () => {
    loadConfig.mockReturnValueOnce({ mode: "live" });
    const snapshot = { status: "stale", revision: "a".repeat(40), headRevision: "b".repeat(40), indexedAt: "2026-11-27T16:40:00Z", snapshot: {} };
    readGitHubWorkspace.mockResolvedValueOnce({ snapshot, userId: "private-actor", repository: { id: "31" } });
    const live = await GET(request, context);
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("private, no-store");
    expect(live.headers.get("x-nutshell-provider")).toBe("github");
    expect(await live.json()).toEqual(snapshot);
    expect(readGitHubWorkspace).toHaveBeenCalledWith(request.headers, "31");
    expect(readFixtureSnapshot).not.toHaveBeenCalled();

    loadConfig.mockReturnValueOnce({ mode: "local-alpha" });
    readFixtureSnapshot.mockResolvedValueOnce(snapshot);
    const local = await GET(request, context);
    expect(local.headers.get("x-nutshell-provider")).toBe("fixture");
    expect(readFixtureSnapshot).toHaveBeenCalledWith(request.headers, "31");
    expect(readGitHubWorkspace).toHaveBeenCalledOnce();
  });

  it("does not return cached content or fall back when access is denied or the live runtime fails", async () => {
    loadConfig.mockReturnValue({ mode: "live" });
    readGitHubWorkspace.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("private diagnostic"));
    const denied = await GET(request, context);
    const error = await GET(request, context);
    expect(denied.status).toBe(404);
    expect(error.status).toBe(503);
    for (const response of [denied, error]) {
      expect(await response.json()).toEqual({ status: "unavailable" });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("x-nutshell-provider")).toBe(false);
    }
    expect(readFixtureSnapshot).not.toHaveBeenCalled();
  });
});
