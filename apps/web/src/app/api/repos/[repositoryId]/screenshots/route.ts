import { loadConfig } from "@nutshell/server/config";
import { isRasterMimeType, maxRasterUploadBytes } from "@nutshell/server/raster";
import { uploadScreenshotAsset } from "@nutshell/server/screenshot-assets";
import { readBoundedBody } from "../../../request-body";
import { screenshotResponse } from "./screenshot-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maximumDeclarationHeaderLength = 8192;
type RouteContext = { params: Promise<{ repositoryId: string }> };

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const config = loadConfig();
    if (config.mode !== "local-alpha" || config.deployment !== "local") {
      return screenshotResponse({ status: "unavailable" }, 404);
    }
    if (request.headers.get("origin") !== config.origin) return screenshotResponse({ status: "forbidden" }, 403);

    const mimeType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!isRasterMimeType(mimeType)) {
      return screenshotResponse({ status: "invalid", message: "Use the PNG, JPEG, or WebP image media type." }, 415);
    }

    const header = request.headers.get("x-nutshell-screenshot");
    let declaration: unknown;
    if (header !== null) {
      const invalid = { status: "invalid", message: "Provide a valid encoded screenshot declaration." };
      if (header.length > maximumDeclarationHeaderLength) return screenshotResponse(invalid, 400);
      try {
        declaration = JSON.parse(decodeURIComponent(header));
      } catch {
        return screenshotResponse(invalid, 400);
      }
    }
    const bytes = await readBoundedBody(request, maxRasterUploadBytes);
    if (!bytes) return screenshotResponse({ status: "invalid", message: "Upload an image no larger than 8 MiB." }, 413);
    const { repositoryId } = await params;
    const result = await uploadScreenshotAsset(request.headers, repositoryId, { bytes, mimeType, declaration });
    switch (result.status) {
      case "ready": return screenshotResponse(result, 201);
      case "forbidden": return screenshotResponse(result, 403);
      case "unavailable": return screenshotResponse(result, 404);
      case "invalid": return screenshotResponse(result, 400);
    }
  } catch {
    return screenshotResponse({ status: "unavailable" }, 503);
  }
}
