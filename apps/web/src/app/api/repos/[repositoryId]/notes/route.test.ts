import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./[noteId]/route";
import { GET, POST } from "./route";

const services = vi.hoisted(() => ({ config: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({ loadConfig: services.config }));
vi.mock("@nutshell/server/team-notes", async (importOriginal) => ({
  ...await importOriginal<typeof import("@nutshell/server/team-notes")>(),
  listTeamNotes: services.list, createTeamNote: services.create, updateTeamNote: services.update, deleteTeamNote: services.remove,
}));

const origin = "http://127.0.0.1:3000";
const repositoryId = "1001";
const noteId = "0b945c41-122d-4a30-875b-831f028ce1bf";
const endpoint = `${origin}/api/repos/${repositoryId}/notes`;
const collection = { params: Promise.resolve({ repositoryId }) };
const item = { params: Promise.resolve({ repositoryId, noteId }) };

function noteContent(text: string) {
  return { schemaVersion: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
}

function mutation(method: string, body: unknown, options: { origin?: string; mediaType?: string; raw?: Uint8Array<ArrayBuffer> } = {}) {
  return new Request(method === "POST" ? endpoint : `${endpoint}/${noteId}`, {
    method,
    headers: { origin: options.origin ?? origin, "content-type": options.mediaType ?? "application/json", cookie: "test-session=1" },
    body: options.raw ?? JSON.stringify(body),
  });
}

describe("team note HTTP routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    services.config.mockReturnValue({ mode: "local-alpha", deployment: "local", origin });
  });

  it("forwards the viewer session and repository and returns private authorized data", async () => {
    const ready = { status: "ready", notes: [], viewerId: "reader", canManage: false, truncated: false };
    services.list.mockResolvedValueOnce(ready).mockResolvedValueOnce({ status: "unavailable" }).mockRejectedValueOnce(new Error("private detail"));
    const request = new Request(endpoint, { headers: { cookie: "test-session=1" } });
    const response = await GET(request, collection);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(ready);
    expect(services.list).toHaveBeenNthCalledWith(1, request.headers, repositoryId);
    expect((await GET(request, collection)).status).toBe(404);
    const failed = await GET(request, collection);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ status: "unavailable" });
  });

  it("rejects nonlocal or cross-origin mutation and malformed, unsupported, or oversized bodies before service access", async () => {
    const input = { title: "Notes", content: noteContent("Content") };
    const denied = await POST(mutation("POST", input, { origin: "https://other.test" }), collection);
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect((await POST(mutation("POST", input, { raw: Uint8Array.of(0xC3, 0x28) }), collection)).status).toBe(400);
    expect((await POST(mutation("POST", input, { raw: Uint8Array.of(0x7B) }), collection)).status).toBe(400);
    expect((await PATCH(mutation("PATCH", { version: 1 }, { mediaType: "text/plain" }), item)).status).toBe(415);
    expect((await DELETE(mutation("DELETE", { content: "x".repeat(65_536) }), item)).status).toBe(413);
    services.config.mockReturnValueOnce({ mode: "live", deployment: "hosted" });
    expect((await POST(mutation("POST", input), collection)).status).toBe(404);
    expect(services.create).not.toHaveBeenCalled();
    expect(services.update).not.toHaveBeenCalled();
    expect(services.remove).not.toHaveBeenCalled();
  });

  it("passes versioned content through unchanged and returns the authoritative mutation outcome", async () => {
    const input = { title: "Notes", content: noteContent("  雪 🧭\nOriginal text  ") };
    const stored = { ...input, id: noteId, version: 1 };
    const created = { status: "created", note: stored };
    services.create.mockResolvedValueOnce(created);
    const request = mutation("POST", input, { mediaType: "application/json; charset=utf-8" });
    const response = await POST(request, collection);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(created);
    expect(services.create).toHaveBeenCalledWith(request.headers, repositoryId, input);

    const forbidden = { status: "forbidden", message: "Only the creator or coordinator may edit." };
    const invalid = { status: "invalid", message: "Use a valid note revision." };
    services.update.mockResolvedValueOnce(forbidden).mockResolvedValueOnce(invalid);
    const rejected = await PATCH(mutation("PATCH", { version: 1, changes: { title: "New" } }), item);
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toEqual(forbidden);
    expect((await PATCH(mutation("PATCH", { version: "1" }), item)).status).toBe(400);
  });

  it("uses exact note IDs and preserves the current note and attempted content on optimistic conflicts", async () => {
    const malformed = { params: Promise.resolve({ repositoryId, noteId: "../note" }) };
    expect((await PATCH(mutation("PATCH", { version: 1 }), malformed)).status).toBe(400);
    expect(services.update).not.toHaveBeenCalled();

    const note = { id: noteId, version: 2, title: "Current title", content: noteContent("Saved server text") };
    const attempted = { version: 1, changes: { content: noteContent("  Local draft stays here.  ") } };
    const conflict = { status: "conflict", reason: "version", note, attempted };
    services.update.mockResolvedValueOnce(conflict);
    const edit = await PATCH(mutation("PATCH", attempted), item);
    expect(edit.status).toBe(409);
    expect(edit.headers.get("cache-control")).toBe("private, no-store");
    expect(await edit.json()).toEqual(conflict);
    expect(services.update).toHaveBeenCalledWith(expect.any(Headers), repositoryId, noteId, attempted);

    const staleDelete = { ...conflict, attempted: { version: 1 } };
    services.remove.mockResolvedValueOnce(staleDelete).mockResolvedValueOnce({ status: "deleted", id: noteId });
    const stale = await DELETE(mutation("DELETE", { version: 1 }), item);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual(staleDelete);
    expect((await DELETE(mutation("DELETE", { version: 2 }), item)).status).toBe(200);
    expect(services.remove).toHaveBeenLastCalledWith(expect.any(Headers), repositoryId, noteId, { version: 2 });
  });
});
