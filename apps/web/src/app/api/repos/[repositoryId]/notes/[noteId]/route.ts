import { deleteTeamNote, teamNoteIdSchema, updateTeamNote } from "@nutshell/server/team-notes";
import { noteResponse, readNoteRequest } from "../note-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string; noteId: string }> };

async function mutateNote(request: Request, { params }: RouteContext, writeNote: typeof updateTeamNote | typeof deleteTeamNote): Promise<Response> {
  const write = await readNoteRequest(request);
  if (!write.ok) return write.response;

  try {
    const { repositoryId, noteId } = await params;
    if (!teamNoteIdSchema.safeParse(noteId).success) {
      return noteResponse({ status: "invalid", message: "Provide a valid note ID." });
    }
    return noteResponse(await writeNote(request.headers, repositoryId, noteId, write.input));
  } catch {
    return noteResponse({ status: "unavailable" }, 503);
  }
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return mutateNote(request, context, updateTeamNote);
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return mutateNote(request, context, deleteTeamNote);
}
