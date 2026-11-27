import { deleteTeamTask, teamTaskIdSchema, updateTeamTask } from "@nutshell/server/team-tasks";
import { readTaskRequest, taskResponse } from "../task-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string; taskId: string }> };

async function mutateTask(request: Request, { params }: RouteContext, writeTask: typeof updateTeamTask | typeof deleteTeamTask): Promise<Response> {
  const write = await readTaskRequest(request);
  if (!write.ok) return write.response;

  try {
    const { repositoryId, taskId } = await params;
    if (!teamTaskIdSchema.safeParse(taskId).success) {
      return taskResponse({ status: "invalid", message: "Provide a valid task ID." });
    }
    return taskResponse(await writeTask(request.headers, repositoryId, taskId, write.input));
  } catch {
    return taskResponse({ status: "unavailable" }, 503);
  }
}

export function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return mutateTask(request, context, updateTeamTask);
}

export function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return mutateTask(request, context, deleteTeamTask);
}
