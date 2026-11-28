import { loadConfig } from "@nutshell/server/config";
import { openGitHubSetup, readGitHubSetup } from "@nutshell/server/runtime";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };
const statusCodes = { ready: 200, awaiting_merge: 200, configured: 200, stale: 409, conflict: 409, forbidden: 403, unavailable: 404 } as const;
const revision = /^(?:[a-f\d]{40}|[a-f\d]{64})$/u;

function reply(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    if (loadConfig().mode !== "live") return reply({ status: "unavailable" }, 404);
    const { repositoryId } = await params;
    const result = await readGitHubSetup(request.headers, repositoryId);
    return reply(result, statusCodes[result.status]);
  } catch {
    return reply({ status: "unavailable" }, 503);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const config = loadConfig();
    if (config.mode !== "live") return reply({ status: "unavailable" }, 404);
    if (request.headers.get("origin") !== config.origin) return reply({ status: "forbidden" }, 403);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return reply({ status: "unavailable" }, 415);
    }
    let body: unknown;
    try {
      const bytes = await readBoundedBody(request, 256);
      if (!bytes) return reply({ status: "unavailable" }, 413);
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return reply({ status: "unavailable" }, 400);
    }
    if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !("sourceRevision" in body) ||
        typeof body.sourceRevision !== "string" || !revision.test(body.sourceRevision)) return reply({ status: "unavailable" }, 400);
    const { repositoryId } = await params;
    const result = await openGitHubSetup(request.headers, repositoryId, body.sourceRevision);
    return reply(result, statusCodes[result.status]);
  } catch {
    return reply({ status: "unavailable" }, 503);
  }
}
