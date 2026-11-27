import { loadConfig } from "@nutshell/server/config";
import { getAuth } from "@nutshell/server/runtime";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const url = new URL(loadConfig().origin);
  if (request.headers.get("host") !== url.host) return new Response("Invalid request host", { status: 421 });

  // Next can supply localhost as the handler URL for a numeric loopback host.
  // Preserve the original Origin header for Better Auth's independent check.
  const routedUrl = new URL(request.url);
  url.pathname = routedUrl.pathname;
  url.search = routedUrl.search;
  return getAuth().handler(new Request(url, request));
}

export { handle as GET, handle as POST };
