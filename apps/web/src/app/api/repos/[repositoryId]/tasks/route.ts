import { createTeamTask, listTeamTasks } from "@nutshell/server/team-tasks";
import { readTaskRequest, taskResponse } from "./task-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ repositoryId: string }> };

export async function GET(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { repositoryId } = await params;
    return taskResponse(await listTeamTasks(request.headers, repositoryId));
  } catch {
    return taskResponse({ status: "unavailable" }, 503);
  }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
  const write = await readTaskRequest(request);
  if (!write.ok) return write.response;

  try {
    const { repositoryId } = await params;
    return taskResponse(await createTeamTask(request.headers, repositoryId, write.input));
  } catch {
    return taskResponse({ status: "unavailable" }, 503);
  }
}
