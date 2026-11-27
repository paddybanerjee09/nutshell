import { loadConfig } from "@nutshell/server/config";
import { maxFixtureDraftPathBytes } from "@nutshell/server/fixture-drafts";
import { mergeFixtureDraftProposal, proposeFixtureDraft, readFixtureDraftProposal } from "@nutshell/server/fixture-draft-proposals";
import { sendFixturePush } from "../../../fixture-push";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };
type ProposalAction =
  | { action: "propose"; path: string; version: number; expectedHead?: string }
  | { action: "merge"; path: string; proposalId: string; expectedHead: string };

const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const proposalUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const maxBodyBytes = 6 * maxFixtureDraftPathBytes + 512;
const resultStatus = { ready: 200, open: 200, merged: 200, unavailable: 404, forbidden: 403, conflict: 409, invalid: 400, invalid_candidate: 422 } as const;

function response(body: object, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function isBoundedPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && Buffer.byteLength(path) <= maxFixtureDraftPathBytes;
}

function readAction(value: unknown): ProposalAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { action, path, expectedHead, proposalId, version } = value as Record<string, unknown>;
  if (!isBoundedPath(path)) return null;
  const keyCount = Object.keys(value).length;
  if (action === "merge" && keyCount === 4 && typeof proposalId === "string" && proposalUuid.test(proposalId) &&
      typeof expectedHead === "string" && revision.test(expectedHead)) {
    return { action, path, proposalId, expectedHead };
  }
  if (action === "propose" && typeof version === "number" && Number.isSafeInteger(version) && version > 0) {
    if (keyCount === 3 && expectedHead === undefined) return { action, path, version };
    if (keyCount === 4 && typeof expectedHead === "string" && revision.test(expectedHead)) return { action, path, version, expectedHead };
  }
  return null;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const config = loadConfig();
    if (config.mode !== "local-alpha" || config.deployment !== "local") return response({ status: "unavailable" }, 404);
    const paths = new URL(request.url).searchParams.getAll("path");
    const [path] = paths;
    if (paths.length !== 1 || !isBoundedPath(path)) return response({ status: "invalid" }, 400);
    const { repositoryId } = await params;
    const result = await readFixtureDraftProposal(request.headers, repositoryId, path);
    return response(result, resultStatus[result.status]);
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return response({ status: "unavailable" }, 503);
  }
  if (config.mode !== "local-alpha" || config.deployment !== "local" || !config.webhookSecret) {
    return response({ status: "unavailable" }, 404);
  }
  if (request.headers.get("origin") !== config.origin) return response({ status: "forbidden" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return response({ status: "invalid" }, 415);
  }

  let action: ProposalAction | null;
  try {
    const payload = await readBoundedBody(request, maxBodyBytes);
    if (!payload) return response({ status: "too_large" }, 413);
    action = readAction(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  } catch {
    return response({ status: "invalid" }, 400);
  }
  if (!action) return response({ status: "invalid" }, 400);

  try {
    const { repositoryId } = await params;
    const { path, expectedHead } = action;
    if (action.action === "propose") {
      const result = await proposeFixtureDraft(request.headers, repositoryId, { path, version: action.version, expectedHead });
      return response(result, resultStatus[result.status]);
    }
    const result = await mergeFixtureDraftProposal(request.headers, repositoryId, { path, proposalId: action.proposalId, expectedHead: action.expectedHead });
    if (result.status !== "merged") return response(result, resultStatus[result.status]);
    const { proposal, delivery } = result;
    if (!await sendFixturePush(config.origin, config.webhookSecret, delivery).catch(() => false)) {
      return response({ status: "delivery_pending", proposal }, 502);
    }
    return response({ status: "merged", proposal });
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}
