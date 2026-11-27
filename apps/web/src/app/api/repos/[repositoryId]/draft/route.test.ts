import { beforeEach, expect, test, vi } from "vitest";
import { GET, PATCH, POST } from "./route";

const services = vi.hoisted(() => ({ config: vi.fn(), list: vi.fn(), read: vi.fn(), create: vi.fn(), save: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({ loadConfig: services.config }));
vi.mock("@nutshell/server/fixture-drafts", () => ({
  maxFixtureDraftBytes: 256 * 1024, maxFixtureDraftPathBytes: 512, maxFixtureDraftTitleLength: 160,
  listFixtureNewDrafts: services.list, readFixtureDraft: services.read, createFixtureDraft: services.create, saveFixtureDraft: services.save,
}));

const origin = "http://127.0.0.1:3000";
const endpoint = origin + "/api/repos/1001/draft";
const params = { params: Promise.resolve({ repositoryId: "1001" }) };
const path = "nutshell-vault/features/New note.md";
const sourceRevision = "a".repeat(40);
const creation = { path, title: "New note", sourceRevision };

function write(method: "POST" | "PATCH", body: object, relatedOrigin = origin) {
  return new Request(endpoint, {
    method, headers: { origin: relatedOrigin, "content-type": "application/json", cookie: "test-session=1" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  services.config.mockReturnValue({ mode: "local-alpha", deployment: "local", origin });
});

test("creates a private absent-source draft with a strict same-origin request", async () => {
  const saved = { status: "saved", draft: { path, sourceRevision, sourceBlob: null, version: 1, markdown: "# New note" } };
  services.create.mockResolvedValue(saved);
  expect((await POST(write("POST", { ...creation, version: 0 }), params)).status).toBe(400);
  expect((await POST(write("POST", { ...creation, sourceRevision: "wrong" }), params)).status).toBe(400);
  expect((await POST(write("POST", { ...creation, title: "a".repeat(5_000) }), params)).status).toBe(413);
  expect((await POST(write("POST", creation, "https://untrusted.invalid"), params)).status).toBe(403);
  expect(services.create).not.toHaveBeenCalled();
  const response = await POST(write("POST", creation), params);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(saved);
  expect(services.create).toHaveBeenCalledWith(expect.any(Headers), "1001", creation);
});

test("lists only writer-scoped private paths without changing exact file reads or saves", async () => {
  const list = { status: "ready", drafts: [{ path }] };
  services.list.mockResolvedValueOnce({ status: "forbidden" }).mockResolvedValueOnce(list);
  expect((await GET(new Request(endpoint), params)).status).toBe(403);
  const response = await GET(new Request(endpoint), params);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual(list);
  expect(services.list).toHaveBeenCalledWith(expect.any(Headers), "1001");
  expect((await GET(new Request(endpoint + "?path="), params)).status).toBe(400);
  expect((await GET(new Request(endpoint + "?path=first&path=second"), params)).status).toBe(400);

  const draft = { path, sourceRevision, sourceBlob: null, version: 1, markdown: "# New note" };
  const read = { status: "ready", source: "", sourceRevision, draft };
  services.read.mockResolvedValue(read);
  const exact = await GET(new Request(endpoint + "?path=" + encodeURIComponent(path)), params);
  expect(await exact.json()).toEqual(read);
  const edit = { path, sourceRevision, version: 1, markdown: "# Revised note" };
  const edited = { status: "saved", draft: { ...draft, markdown: edit.markdown, version: 2 } };
  services.save.mockResolvedValue(edited);
  expect(await (await PATCH(write("PATCH", edit), params)).json()).toEqual(edited);
  expect(services.save).toHaveBeenCalledWith(expect.any(Headers), "1001", edit);
});
