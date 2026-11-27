import { loadConfig } from "@nutshell/server/config";
import { maxFixtureDraftBytes, maxFixtureDraftPathBytes, readFixtureDraft, saveFixtureDraft } from "@nutshell/server/fixture-drafts";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };
type DraftEdit = Parameters<typeof saveFixtureDraft>[2];

const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const maxBodyBytes = 6 * (maxFixtureDraftBytes + maxFixtureDraftPathBytes) + 512;
const resultStatus = { ready: 200, saved: 200, unavailable: 404, forbidden: 403, conflict: 409, invalid: 400 } as const;

function response(body: object, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function draftEdit(value: unknown): DraftEdit | null {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 4) return null;
  const { path, markdown, sourceRevision, version } = value as Record<string, unknown>;
  if (typeof path !== "string" || path.length === 0 || Buffer.byteLength(path) > maxFixtureDraftPathBytes ||
      typeof markdown !== "string" || typeof sourceRevision !== "string" || !revision.test(sourceRevision) ||
      typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return null;
  return { path, markdown, sourceRevision, version };
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const paths = new URL(request.url).searchParams.getAll("path");
  const [path] = paths;
  if (paths.length !== 1 || !path || Buffer.byteLength(path) > maxFixtureDraftPathBytes) return response({ status: "invalid" }, 400);

  try {
    const { repositoryId } = await params;
    const result = await readFixtureDraft(request.headers, repositoryId, path);
    return response(result, resultStatus[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return response({ status: "unavailable" }, 503);
  }
  if (config.mode !== "local-alpha" || config.deployment !== "local") return response({ status: "unavailable" }, 404);
  if (request.headers.get("origin") !== config.origin) return response({ status: "forbidden" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return response({ status: "invalid" }, 415);
  }

  let edit: DraftEdit | null;
  try {
    const body = await readBoundedBody(request, maxBodyBytes);
    if (!body) return response({ status: "too_large" }, 413);
    edit = draftEdit(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)));
  } catch {
    return response({ status: "invalid" }, 400);
  }
  if (!edit) return response({ status: "invalid" }, 400);
  if (Buffer.byteLength(edit.markdown, "utf8") > maxFixtureDraftBytes) return response({ status: "too_large" }, 413);

  try {
    const { repositoryId } = await params;
    const result = await saveFixtureDraft(request.headers, repositoryId, edit);
    return response(result, resultStatus[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}
