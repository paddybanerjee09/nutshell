import { loadConfig } from "@nutshell/server/config";
import {
  createFixtureDraft, listFixtureNewDrafts, maxFixtureDraftBytes, maxFixtureDraftPathBytes, maxFixtureDraftTitleLength,
  readFixtureDraft, saveFixtureDraft,
} from "@nutshell/server/fixture-drafts";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };
type DraftEdit = Parameters<typeof saveFixtureDraft>[2];
type DraftCreation = Parameters<typeof createFixtureDraft>[2];

const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const maxEditBodyBytes = 6 * (maxFixtureDraftBytes + maxFixtureDraftPathBytes) + 512;
const maxCreateBodyBytes = 6 * (maxFixtureDraftTitleLength + maxFixtureDraftPathBytes) + 512;
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

function draftCreation(value: unknown): DraftCreation | null {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 3) return null;
  const { path, title, sourceRevision } = value as Record<string, unknown>;
  if (typeof path !== "string" || path.length === 0 || Buffer.byteLength(path) > maxFixtureDraftPathBytes ||
      typeof title !== "string" || title.length > maxFixtureDraftTitleLength ||
      typeof sourceRevision !== "string" || !revision.test(sourceRevision)) return null;
  return { path, title, sourceRevision };
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  const paths = new URL(request.url).searchParams.getAll("path");
  const [path] = paths;
  if (paths.length > 1 || (path !== undefined && (!path || Buffer.byteLength(path) > maxFixtureDraftPathBytes))) {
    return response({ status: "invalid" }, 400);
  }

  try {
    const config = loadConfig();
    if (config.mode !== "local-alpha" || config.deployment !== "local") return response({ status: "unavailable" }, 404);
    const { repositoryId } = await params;
    const result = path === undefined ? await listFixtureNewDrafts(request.headers, repositoryId)
      : await readFixtureDraft(request.headers, repositoryId, path);
    return response(result, resultStatus[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}

async function writeDraft(request: Request, { params }: RouteContext, operation: "create" | "edit"): Promise<Response> {
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

  let draft: DraftEdit | DraftCreation | null;
  try {
    const body = await readBoundedBody(request, operation === "create" ? maxCreateBodyBytes : maxEditBodyBytes);
    if (!body) return response({ status: "too_large" }, 413);
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    draft = operation === "create" ? draftCreation(input) : draftEdit(input);
  } catch {
    return response({ status: "invalid" }, 400);
  }
  if (!draft) return response({ status: "invalid" }, 400);
  if ("markdown" in draft && Buffer.byteLength(draft.markdown, "utf8") > maxFixtureDraftBytes) return response({ status: "too_large" }, 413);

  try {
    const { repositoryId } = await params;
    const result = "markdown" in draft ? await saveFixtureDraft(request.headers, repositoryId, draft)
      : await createFixtureDraft(request.headers, repositoryId, draft);
    return response(result, resultStatus[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}

export function POST(request: Request, context: RouteContext): Promise<Response> {
  return writeDraft(request, context, "create");
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return writeDraft(request, context, "edit");
}
