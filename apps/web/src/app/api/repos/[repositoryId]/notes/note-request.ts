import { loadConfig } from "@nutshell/server/config";
import { readBoundedBody } from "../../../request-body";

const maxNoteRequestBytes = 64 * 1024;
const statusCodes = {
  ready: 200, created: 201, updated: 200, deleted: 200,
  invalid: 400, forbidden: 403, unavailable: 404, conflict: 409, too_large: 413,
} as const;

export function noteResponse<T extends { status: keyof typeof statusCodes }>(body: T, status: number = statusCodes[body.status]): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

type NoteRequest = { ok: true; input: unknown } | { ok: false; response: Response };

export async function readNoteRequest(request: Request): Promise<NoteRequest> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return { ok: false, response: noteResponse({ status: "unavailable" }, 503) };
  }
  if (config.mode !== "local-alpha" || config.deployment !== "local") {
    return { ok: false, response: noteResponse({ status: "unavailable" }) };
  }
  if (request.headers.get("origin") !== config.origin) {
    return { ok: false, response: noteResponse({ status: "forbidden" }) };
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, response: noteResponse({ status: "invalid", message: "Use an application/json request body." }, 415) };
  }

  try {
    const body = await readBoundedBody(request, maxNoteRequestBytes);
    if (!body) return { ok: false, response: noteResponse({ status: "too_large", message: "Note request body is too large." }) };
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return { ok: true, input };
  } catch {
    return { ok: false, response: noteResponse({ status: "invalid", message: "Provide a valid UTF-8 JSON note request." }) };
  }
}
