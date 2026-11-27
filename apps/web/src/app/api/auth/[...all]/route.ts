import { loadConfig } from "@nutshell/server/config";
import { getAuth } from "@nutshell/server/runtime";

export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };

async function handle(request: Request): Promise<Response> {
  try {
    const { origin, mode } = loadConfig();
    const url = new URL(origin);
    if (request.headers.get("host") !== url.host) return new Response("Invalid request host", { status: 421, headers: privateHeaders });

    // Preserve the original Origin header for Better Auth's independent check.
    const routedUrl = new URL(request.url);
    const path = routedUrl.pathname.replace(/\/+$/u, "");
    if (mode === "live" && path === "/api/auth/nutshell/persona") {
      return Response.json({ status: "unavailable" }, { status: 404, headers: privateHeaders });
    }
    if (mode === "live" && path === "/api/auth/error" && request.method === "GET") {
      return new Response(null, { status: 303, headers: {
        ...privateHeaders, Location: new URL("/login?github=unavailable", url).href,
      } });
    }
    url.pathname = routedUrl.pathname;
    url.search = routedUrl.search;
    return await getAuth().handler(new Request(url, request));
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: privateHeaders });
  }
}

export { handle as GET, handle as POST };
