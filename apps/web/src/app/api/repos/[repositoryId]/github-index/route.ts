import { loadConfig } from "@nutshell/server/config";
import { requestGitHubReconciliation } from "@nutshell/server/github-live-sync";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resultCodes = { queued: 202, current: 200, forbidden: 403, unavailable: 404 } as const;

function response(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  try {
    const config = loadConfig();
    if (config.mode !== "live") return response({ status: "unavailable" }, 404);
    if (request.headers.get("origin") !== config.origin) return response({ status: "forbidden" }, 403);
    if (!(await readBoundedBody(request, 0))) return response({ status: "unavailable" }, 400);
    const { repositoryId } = await params;
    const result = await requestGitHubReconciliation(request.headers, repositoryId);
    return response(result, resultCodes[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}
