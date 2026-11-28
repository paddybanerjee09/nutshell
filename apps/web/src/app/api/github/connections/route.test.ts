import { beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const fixture = vi.hoisted(() => ({
  config: vi.fn(), list: vi.fn(), connect: vi.fn(), origin: "https://nutshell.example.invalid",
}));

vi.mock("@nutshell/server/config", () => ({ loadConfig: fixture.config }));
vi.mock("@nutshell/server/runtime", () => ({ listGitHubConnections: fixture.list, connectGitHubRepository: fixture.connect }));

function request(body?: unknown, origin = fixture.origin) {
  return new Request(fixture.origin + "/api/github/connections", body === undefined ? undefined : {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.config.mockReturnValue({ mode: "live", origin: fixture.origin });
});

it("uses session-bound runtime only in live mode and keeps replies private", async () => {
  fixture.list.mockResolvedValue({ status: "ready", candidates: [], installationUrl: "https://github.com/apps/nutshell/installations/new" });
  const input = request();
  const response = await GET(input);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.list).toHaveBeenCalledWith(input.headers);
  fixture.config.mockReturnValue({ mode: "local-alpha", origin: "http://127.0.0.1:3000" });
  expect((await GET(request())).status).toBe(404);
  expect((await POST(request({ repositoryId: 12, installationId: 56 }))).status).toBe(404);
  expect(fixture.list).toHaveBeenCalledTimes(1);
  expect(fixture.connect).not.toHaveBeenCalled();
});

it("requires a same-origin bounded submission carrying only two numeric identities", async () => {
  const target = { repositoryId: 12, installationId: 56 };
  expect((await POST(request(target, "https://foreign.invalid"))).status).toBe(403);
  expect((await POST(request({ ...target, ownerId: 99 }))).status).toBe(400);
  expect((await POST(request({ ...target, repositoryId: "12" }))).status).toBe(400);
  expect((await POST(request({ ...target, installationId: "x".repeat(513) }))).status).toBe(413);
  expect(fixture.connect).not.toHaveBeenCalled();
  fixture.connect.mockResolvedValue({ status: "connected", repositoryId: "12" });
  const input = request(target);
  const response = await POST(input);
  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ status: "connected", repositoryId: "12" });
  expect(fixture.connect).toHaveBeenCalledWith(input.headers, target);
});

it.each([["reauthorize", 401], ["denied", 403], ["conflict", 409], ["unavailable", 503]] as const)(
  "preserves the protected runtime %s outcome", async (status, code) => {
    fixture.connect.mockResolvedValue({ status });
    const result = await POST(request({ repositoryId: 12, installationId: 56 }));
    expect(result.status).toBe(code);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ status });
  },
);
