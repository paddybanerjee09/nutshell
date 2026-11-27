import { loadConfig } from "@nutshell/server/config";
import { PgBoss } from "pg-boss";
import { workerProbeQueue, type WorkerProbe } from "./probe.ts";

export async function runWorker(): Promise<void> {
  const { databaseUrl } = loadConfig();
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: "nutshell-worker",
    connectionTimeoutMillis: 2_000,
    schedule: false,
  });
  boss.on("error", () => console.error("Nutshell worker database operation failed."));

  const { promise: shutdown, resolve } = Promise.withResolvers<void>();
  let shuttingDown = false;
  function requestShutdown(): void {
    shuttingDown = true;
    resolve();
  }
  function onMessage(message: unknown): void {
    if (message && typeof message === "object" && "type" in message && message.type === "shutdown") {
      requestShutdown();
    }
  }
  process.on("message", onMessage);
  process.once("disconnect", requestShutdown);
  process.on("SIGINT", requestShutdown);
  process.on("SIGTERM", requestShutdown);

  try {
    await boss.start({ attempts: 3 });
    if (shuttingDown) return;
    await boss.createQueue(workerProbeQueue, {
      expireInSeconds: 10,
      retentionSeconds: 120,
      deleteAfterSeconds: 120,
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 4,
    });
    if (shuttingDown) return;
    await boss.work<WorkerProbe, WorkerProbe | undefined>(
      workerProbeQueue,
      { pollingIntervalSeconds: 1 },
      async ([job]) => job?.data,
    );
    if (!shuttingDown && process.connected) {
      process.send?.({ type: "ready" }, (error) => {
        if (error) requestShutdown();
      });
    }
    await shutdown;
  } finally {
    try {
      await boss.stop({ graceful: true, timeout: 5_000 });
    } finally {
      process.off("message", onMessage);
      process.off("disconnect", requestShutdown);
      process.off("SIGINT", requestShutdown);
      process.off("SIGTERM", requestShutdown);
      if (process.connected) process.disconnect?.();
    }
  }
}

if (import.meta.main) {
  try {
    await runWorker();
  } catch {
    console.error("Nutshell worker could not start or shut down cleanly.");
    process.exitCode = 1;
  }
}
