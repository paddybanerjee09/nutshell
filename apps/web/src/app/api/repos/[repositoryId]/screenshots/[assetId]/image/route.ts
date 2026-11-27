import { readScreenshotAsset } from "@nutshell/server/screenshot-assets";
import { screenshotHeaders, screenshotResponse } from "../../screenshot-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string; assetId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { repositoryId, assetId } = await params;
    const result = await readScreenshotAsset(request.headers, repositoryId, assetId, { includeBytes: true });
    if (result.status !== "ready" || !result.bytes) return screenshotResponse({ status: "unavailable" }, 404);
    const headers = screenshotHeaders();
    headers.set("Content-Type", result.asset.mimeType);
    headers.set("Content-Length", String(result.bytes.byteLength));
    headers.set("Content-Disposition", "inline");
    return new Response(new Uint8Array(result.bytes), { headers });
  } catch {
    return screenshotResponse({ status: "unavailable" }, 503);
  }
}
