import { readFixtureHistoryMemory } from "@nutshell/server/fixture-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Nutshell-Provider": "fixture" };

export async function GET(request: Request, { params }: { params: Promise<{ repositoryId: string; changeId: string }> }): Promise<Response> {
  try {
    const { repositoryId, changeId } = await params;
    const paths = new URL(request.url).searchParams.getAll("path");
    const memory = paths.length === 1 && paths[0] ? await readFixtureHistoryMemory(request.headers, repositoryId, changeId, paths[0]) : null;
    return memory ? Response.json(memory, { headers }) : Response.json({ status: "unavailable" }, { status: 404, headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
