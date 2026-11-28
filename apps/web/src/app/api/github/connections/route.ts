import { loadConfig } from "@nutshell/server/config";
import { connectGitHubRepository, listGitHubConnections } from "@nutshell/server/runtime";
import { readBoundedBody } from "../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusCodes = { ready: 200, connected: 201, denied: 403, conflict: 409, reauthorize: 401, unavailable: 503 } as const;

function reply(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function GET(request: Request) {
  try {
    if (loadConfig().mode !== "live") return reply({ status: "unavailable" }, 404);
    const result = await listGitHubConnections(request.headers);
    return reply(result, statusCodes[result.status]);
  } catch {
    return reply({ status: "unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const config = loadConfig();
    if (config.mode !== "live") return reply({ status: "unavailable" }, 404);
    if (request.headers.get("origin") !== config.origin) return reply({ status: "denied" }, 403);
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      return reply({ status: "invalid" }, 415);
    }
    let body: unknown;
    try {
      const bytes = await readBoundedBody(request, 512);
      if (!bytes) return reply({ status: "invalid" }, 413);
      body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return reply({ status: "invalid" }, 400);
    }
    if (!body || typeof body !== "object" || Object.keys(body).length !== 2 ||
        !("repositoryId" in body) || !("installationId" in body) || !isId(body.repositoryId) || !isId(body.installationId)) {
      return reply({ status: "invalid" }, 400);
    }
    const result = await connectGitHubRepository(request.headers, { repositoryId: body.repositoryId, installationId: body.installationId });
    return reply(result, statusCodes[result.status]);
  } catch {
    return reply({ status: "unavailable" }, 503);
  }
}
