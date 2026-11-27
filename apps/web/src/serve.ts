import { once } from "node:events";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { fileURLToPath } from "node:url";
import next from "next";
import { loadConfig } from "@nutshell/server/config";
import { closeRuntime, healthCheck } from "@nutshell/server/runtime";

async function start() {
  const args = process.argv.slice(2);
  const optimized = args.length === 1 && args[0] === "--optimized";
  if (args.length && !optimized) throw new Error("Usage: node apps/web/src/serve.ts [--optimized]");

  const url = new URL(loadConfig().origin);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Nutshell's local web server requires a loopback HTTP origin.");
  }

  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const port = Number(url.port || 80);
  const app = next({ dev: !optimized, dir: fileURLToPath(new URL("../", import.meta.url)), hostname, port });
  const handle = app.getRequestHandler();
  const server = createServer((request, response) => {
    if (request.headers.host !== url.host) {
      response.writeHead(421).end("Invalid request host");
      return;
    }
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end("Unexpected server error");
      else response.destroy();
    });
  });

  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  try {
    await app.prepare();
    await healthCheck();
    server.listen(port, hostname);
    await once(server, "listening");
  } catch (error) {
    await Promise.allSettled([app.close(), closeRuntime()]);
    throw error;
  }

  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => {
      for (const socket of sockets) socket.destroy();
    }, 2_000);
    timeout.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(timeout);
    const results = await Promise.allSettled([app.close(), closeRuntime()]);
    if (process.connected) process.disconnect();
    // Next's dev watchers can remain active after its cleanup promise settles.
    process.exit(results.some((result) => result.status === "rejected") ? 1 : 0);
  }

  const stop = () => void shutdown();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("disconnect", stop);
  process.on("message", (message: unknown) => {
    if (message === "shutdown" ||
      (message !== null && typeof message === "object" && "type" in message && message.type === "shutdown")) stop();
  });

  console.log(`Nutshell web listening at ${url.origin}`);
  process.send?.({ type: "ready" });
}

try {
  await start();
} catch (error) {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
  console.error(`Nutshell web startup failed${code}. Check the runtime configuration, database, port, and build output.`);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
