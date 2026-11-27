import { healthCheck } from "@nutshell/server/runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    await healthCheck();
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
