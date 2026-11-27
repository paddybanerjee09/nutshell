import { maxRasterUploadBytes } from "@nutshell/server/raster";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readImage } from "./[assetId]/image/route";
import { GET as readMetadata } from "./[assetId]/route";
import { POST as uploadImage } from "./route";

const mocks = vi.hoisted(() => ({ config: vi.fn(), upload: vi.fn(), read: vi.fn() }));
vi.mock("@nutshell/server/config", () => ({ loadConfig: mocks.config }));
vi.mock("@nutshell/server/screenshot-assets", () => ({ uploadScreenshotAsset: mocks.upload, readScreenshotAsset: mocks.read }));

const origin = "http://127.0.0.1:3000";
const repositoryId = "1001";
const assetId = "asset_a355cf99-b607-4545-ae32-1f60619c5ef1";
const collection = { params: Promise.resolve({ repositoryId }) };
const item = { params: Promise.resolve({ repositoryId, assetId }) };
const endpoint = `${origin}/api/repos/${repositoryId}/screenshots`;
const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
const asset = { id: assetId, mimeType: "image/png", width: 1, height: 1, sha256: "a".repeat(64), byteLength: bytes.length,
  createdAt: "2026-11-27T10:00:00.000Z", provenance: "declared", captureRef: null, declaration: null };

function upload(headers?: HeadersInit, body: Uint8Array<ArrayBuffer> = bytes) {
  const input = new Headers({ origin, "content-type": "image/png", cookie: "test-session=1" });
  new Headers(headers).forEach((value, name) => input.set(name, value));
  return new Request(endpoint, { method: "POST", headers: input, body });
}

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
}

describe("private screenshot HTTP routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.config.mockReturnValue({ mode: "local-alpha", deployment: "local", origin });
  });

  it("forwards raw bytes, current session headers and optional encoded declaration without adding capture facts", async () => {
    const declaration = { sourceRevision: "a".repeat(40), route: "/screens/雪", state: "可視", viewport: { width: 1440, height: 900 },
      environment: "local test" };
    mocks.upload.mockResolvedValueOnce({ status: "ready", asset: { ...asset, declaration } })
      .mockResolvedValueOnce({ status: "ready", asset });
    const first = upload({ "x-nutshell-screenshot": encodeURIComponent(JSON.stringify(declaration)) });
    const response = await uploadImage(first, collection);
    expect(response.status).toBe(201);
    expectPrivate(response);
    expect(await response.json()).toEqual({ status: "ready", asset: { ...asset, declaration } });
    expect(mocks.upload).toHaveBeenNthCalledWith(1, first.headers, repositoryId, {
      bytes: Buffer.from(bytes), mimeType: "image/png", declaration,
    });

    const withoutDeclaration = upload();
    expect(await (await uploadImage(withoutDeclaration, collection)).json()).toEqual({ status: "ready", asset });
    expect(mocks.upload).toHaveBeenNthCalledWith(2, withoutDeclaration.headers, repositoryId, {
      bytes: Buffer.from(bytes), mimeType: "image/png", declaration: undefined,
    });
  });

  it("bounds bytes and declaration parsing and rejects other origins and non-raster media before service access", async () => {
    const denied = await uploadImage(upload({ origin: "https://untrusted.test" }), collection);
    expect(denied.status).toBe(403);
    expectPrivate(denied);
    const missingOrigin = new Request(endpoint, { method: "POST", headers: { "content-type": "image/png" }, body: bytes });
    expect((await uploadImage(missingOrigin, collection)).status).toBe(403);
    for (const type of ["image/svg+xml", "text/html", "image/png; charset=utf-8", "image/gif"]) {
      expect((await uploadImage(upload({ "content-type": type }), collection)).status).toBe(415);
    }
    for (const header of ["%zz", "%7B", "x".repeat(8193)]) {
      expect((await uploadImage(upload({ "x-nutshell-screenshot": header }), collection)).status).toBe(400);
    }
    expect((await uploadImage(upload({ "content-length": String(maxRasterUploadBytes + 1) }), collection)).status).toBe(413);
    expect((await uploadImage(upload(undefined, new Uint8Array(maxRasterUploadBytes + 1)), collection)).status).toBe(413);
    mocks.config.mockReturnValueOnce({ mode: "live", deployment: "hosted", origin });
    expect((await uploadImage(upload(), collection)).status).toBe(404);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("returns the service's current writer decision truthfully", async () => {
    const invalid = { status: "invalid", message: "Use valid screenshot provenance fields." };
    mocks.upload.mockResolvedValueOnce({ status: "forbidden" }).mockResolvedValueOnce({ status: "unavailable" }).mockResolvedValueOnce(invalid);
    expect((await uploadImage(upload(), collection)).status).toBe(403);
    expect((await uploadImage(upload(), collection)).status).toBe(404);
    const response = await uploadImage(upload(), collection);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(invalid);
  });

  it("resolves each metadata and proxy request with the current session and never copies bytes into JSON", async () => {
    mocks.read.mockResolvedValue({ status: "ready", asset, bytes: Buffer.from(bytes) });
    const metadataRequest = new Request(`${endpoint}/${assetId}`, { headers: { cookie: "current-session=1" } });
    const metadata = await readMetadata(metadataRequest, item);
    expectPrivate(metadata);
    expect(await metadata.json()).toEqual({ status: "ready", asset });
    expect(mocks.read).toHaveBeenNthCalledWith(1, metadataRequest.headers, repositoryId, assetId);

    const imageRequest = new Request(`${endpoint}/${assetId}/image`, { headers: { cookie: "current-session=2" } });
    const image = await readImage(imageRequest, item);
    expect(image.status).toBe(200);
    expectPrivate(image);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("content-length")).toBe(String(bytes.length));
    expect(image.headers.get("content-disposition")).toBe("inline");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(bytes);
    expect(mocks.read).toHaveBeenNthCalledWith(2, imageRequest.headers, repositoryId, assetId, { includeBytes: true });
  });

  it("returns a generic private 404 when a scoped asset or its bytes are unavailable", async () => {
    const request = new Request(`${endpoint}/${assetId}`);
    mocks.read.mockResolvedValueOnce({ status: "unavailable" }).mockResolvedValueOnce({ status: "ready", asset });
    for (const handler of [readMetadata, readImage]) {
      const response = await handler(request, item);
      expect(response.status).toBe(404);
      expectPrivate(response);
      expect(await response.json()).toEqual({ status: "unavailable" });
    }
  });
});
