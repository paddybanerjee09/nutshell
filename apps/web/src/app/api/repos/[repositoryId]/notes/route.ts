import { createTeamNote, listTeamNotes } from "@nutshell/server/team-notes";
import { noteResponse, readNoteRequest } from "./note-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { repositoryId } = await params;
    return noteResponse(await listTeamNotes(request.headers, repositoryId));
  } catch {
    return noteResponse({ status: "unavailable" }, 503);
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const write = await readNoteRequest(request);
  if (!write.ok) return write.response;

  try {
    const { repositoryId } = await params;
    return noteResponse(await createTeamNote(request.headers, repositoryId, write.input));
  } catch {
    return noteResponse({ status: "unavailable" }, 503);
  }
}
