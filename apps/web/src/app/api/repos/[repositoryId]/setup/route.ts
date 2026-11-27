import { loadConfig } from "@nutshell/server/config";
import { openFixtureSetup, readFixtureOnboarding, simulateFixtureSetupMerge } from "@nutshell/server/fixture-onboarding";
import { sendFixturePush } from "../../../fixture-push";
import { readBoundedBody } from "../../../request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };
type SetupAction = { action: "open" } | { action: "merge"; expectedHead: string };

const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const errorCodes = { unavailable: 404, forbidden: 403, conflict: 409 } as const;

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function readAction(value: unknown): SetupAction | null {
  if (!value || typeof value !== "object" || !("action" in value)) return null;
  if (value.action === "open" && Object.keys(value).length === 1) return { action: "open" };
  if (value.action === "merge" && "expectedHead" in value && typeof value.expectedHead === "string" &&
      revision.test(value.expectedHead) && Object.keys(value).length === 2) {
    return { action: "merge", expectedHead: value.expectedHead };
  }
  return null;
}

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { repositoryId } = await params;
    const state = await readFixtureOnboarding(request.headers, repositoryId);
    return state ? response(state) : response({ status: "unavailable" }, 404);
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
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") return response({ status: "invalid" }, 415);

  let action: SetupAction | null;
  try {
    const payload = await readBoundedBody(request, 512);
    if (!payload) return response({ status: "too_large" }, 413);
    action = readAction(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  } catch {
    return response({ status: "invalid" }, 400);
  }
  if (!action) return response({ status: "invalid" }, 400);

  try {
    const { repositoryId } = await params;
    if (action.action === "open") {
      const result = await openFixtureSetup(request.headers, repositoryId);
      if (result.status === "open" || result.status === "merged") return response(result);
      return response(result, errorCodes[result.status]);
    }
    const result = await simulateFixtureSetupMerge(request.headers, repositoryId, action.expectedHead);
    if (result.status !== "merged") return response(result, errorCodes[result.status]);
    if (!await sendFixturePush(config.origin, config.webhookSecret, result.delivery).catch(() => false)) {
      return response({ status: "delivery_pending" }, 502);
    }
    return response({ status: result.status, proposal: result.proposal });
  } catch {
    return response({ status: "unavailable" }, 503);
  }
}
