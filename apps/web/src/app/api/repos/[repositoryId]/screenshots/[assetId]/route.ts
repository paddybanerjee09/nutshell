import { readScreenshotAsset } from "@nutshell/server/screenshot-assets";
import { screenshotResponse } from "../screenshot-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string; assetId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { repositoryId, assetId } = await params;
    const result = await readScreenshotAsset(request.headers, repositoryId, assetId);
    if (result.status !== "ready") return screenshotResponse({ status: "unavailable" }, 404);
    return screenshotResponse({ status: "ready", asset: result.asset }, 200);
  } catch {
    return screenshotResponse({ status: "unavailable" }, 503);
  }
}
