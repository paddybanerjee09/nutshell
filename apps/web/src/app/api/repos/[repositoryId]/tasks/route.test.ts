import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./[taskId]/route";
import { GET, POST } from "./route";

const services = vi.hoisted(() => ({ config: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({ loadConfig: services.config }));
vi.mock("@nutshell/server/team-tasks", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nutshell/server/team-tasks")>(),
  listTeamTasks: services.list, createTeamTask: services.create, updateTeamTask: services.update, deleteTeamTask: services.remove,
}));

const origin = "http://127.0.0.1:3000";
const endpoint = origin + "/api/repos/1001/tasks";
const repositoryId = "1001";
const taskId = "0b945c41-122d-4a30-875b-831f028ce1bf";
const params = { params: Promise.resolve({ repositoryId }) };
const item = { params: Promise.resolve({ repositoryId, taskId }) };

function mutation(method: string, body: unknown, options: { origin?: string; contentType?: string; raw?: boolean } = {}) {
  const url = method === "POST" ? endpoint : endpoint + "/" + taskId;
  return new Request(url, { method, headers: {
    origin: options.origin ?? origin, "content-type": options.contentType ?? "application/json", cookie: "test-session=1",
  }, body: options.raw ? String(body) : JSON.stringify(body) });
}

describe("team task HTTP routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.config.mockReturnValue({ mode: "local-alpha", deployment: "local", origin });
  });

  it("returns current authorized list data with private cache control", async () => {
    const ready = { status: "ready", tasks: [], members: [{ id: "reader", name: "Reader" }], viewerId: "reader",
      canManage: false, entities: [], sourceRevision: null, truncated: false };
    services.list.mockResolvedValueOnce({ status: "unavailable" }).mockResolvedValueOnce(ready);
    expect((await GET(new Request(endpoint), params)).status).toBe(404);
    const response = await GET(new Request(endpoint, { headers: { cookie: "test-session=1" } }), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(ready);
    expect(services.list).toHaveBeenLastCalledWith(expect.any(Headers), repositoryId);
    expect(services.list.mock.calls[1]?.[0].get("cookie")).toBe("test-session=1");
  });

  it("rejects cross-origin writes, invalid JSON, unsupported media, and oversized requests before data access", async () => {
    const body = { title: "Check the report" };
    const denied = await POST(mutation("POST", body, { origin: "https://untrusted.invalid" }), params);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(mutation("POST", "{", { raw: true }), params)).status).toBe(400);
    expect((await PATCH(mutation("PATCH", { version: 1 }, { contentType: "text/plain" }), item)).status).toBe(415);
    expect((await DELETE(mutation("DELETE", { oversized: "x".repeat(65_536) }), item)).status).toBe(413);
    services.config.mockReturnValueOnce({ mode: "live", deployment: "hosted" });
    expect((await POST(mutation("POST", body), params)).status).toBe(404);
    expect(services.create).not.toHaveBeenCalled();
    expect(services.update).not.toHaveBeenCalled();
    expect(services.remove).not.toHaveBeenCalled();
  });

  it("passes date-only values and task data unchanged, mapping server validation and authority results", async () => {
    const original = { title: "Check the report", deadline: "2027-03-14", description: "  Retain original text.  " };
    const saved = { status: "created", task: { ...original, id: taskId, version: 1 } };
    services.create.mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ status: "forbidden" })
      .mockResolvedValueOnce({ status: "invalid", message: "Provide a valid task deadline." });
    const response = await POST(mutation("POST", original, { contentType: "application/json; charset=utf-8" }), params);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(saved);
    expect(services.create).toHaveBeenNthCalledWith(1, expect.any(Headers), repositoryId, original);
    expect((await POST(mutation("POST", { ...original, assigneeId: "other" }), params)).status).toBe(403);
    const invalid = await POST(mutation("POST", { ...original, deadline: "2027-03-14T00:00:00Z" }), params);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ status: "invalid", message: "Provide a valid task deadline." });
  });

  it("rejects malformed task IDs and preserves optimistic conflicts for edits and deletes", async () => {
    const malformed = { params: Promise.resolve({ repositoryId, taskId: "../another-task" }) };
    expect((await PATCH(mutation("PATCH", { version: 1 }), malformed)).status).toBe(400);
    expect(services.update).not.toHaveBeenCalled();

    const attempted = { version: 1, changes: { description: "  My draft stays here.  ", deadline: "2027-03-14" } };
    const task = { id: taskId, version: 2, description: "Stored text", deadline: "2027-03-15" };
    const conflict = { status: "conflict", reason: "version", task, attempted };
    services.update.mockResolvedValueOnce(conflict);
    const edit = await PATCH(mutation("PATCH", attempted), item);
    expect(edit.status).toBe(409);
    expect(edit.headers.get("cache-control")).toBe("private, no-store");
    expect(await edit.json()).toEqual(conflict);
    expect(services.update).toHaveBeenCalledWith(expect.any(Headers), repositoryId, taskId, attempted);

    const staleDelete = { status: "conflict", reason: "version", task, attempted: { version: 1 } };
    services.remove.mockResolvedValueOnce(staleDelete).mockResolvedValueOnce({ status: "deleted" });
    const removed = await DELETE(mutation("DELETE", { version: 1 }), item);
    expect(removed.status).toBe(409);
    expect(await removed.json()).toEqual(staleDelete);
    expect((await DELETE(mutation("DELETE", { version: 2 }), item)).status).toBe(200);
    expect(services.remove).toHaveBeenLastCalledWith(expect.any(Headers), repositoryId, taskId, { version: 2 });
  });
});
