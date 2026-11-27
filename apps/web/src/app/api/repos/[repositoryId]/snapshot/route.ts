import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ repositoryId: string }> }): Promise<Response> {
  const { repositoryId } = await context.params;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const snapshot = await readFixtureSnapshot(request.headers, repositoryId);
    if (!snapshot) return Response.json({ status: "unavailable" }, { status: 404, headers });
    return Response.json(snapshot, { headers: { ...headers, "X-Nutshell-Provider": "fixture" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
