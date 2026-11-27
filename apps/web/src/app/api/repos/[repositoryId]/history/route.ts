import { readFixtureProductHistory } from "@nutshell/server/fixture-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Nutshell-Provider": "fixture" };

export async function GET(request: Request, { params }: { params: Promise<{ repositoryId: string }> }): Promise<Response> {
  try {
    const { repositoryId } = await params;
    const history = await readFixtureProductHistory(request.headers, repositoryId);
    return history ? Response.json(history, { headers }) : Response.json({ status: "unavailable" }, { status: 404, headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
