import { setTimeout as delay } from "node:timers/promises";
import { loadLocalConfig } from "@nutshell/server/config";
import { processNextFixtureDelivery } from "@nutshell/server/fixture-sync";
import { closeRuntime } from "@nutshell/server/runtime";
import { PgBoss } from "pg-boss";
import { workerProbeQueue, type WorkerProbe } from "./probe.ts";

async function pollFixtureReceipts(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    try {
      if (await processNextFixtureDelivery()) continue;
    } catch {
      console.error("Nutshell fixture sync database operation failed.");
    }
    try {
      await delay(1_000, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}

export async function runWorker(): Promise<void> {
  const { databaseUrl } = loadLocalConfig();
  const boss = new PgBoss({
    connectionString: databaseUrl,
    application_name: "nutshell-worker",
    connectionTimeoutMillis: 2_000,
    schedule: false,
  });
  boss.on("error", () => console.error("Nutshell worker database operation failed."));

  const shutdown = new AbortController();
  const { signal } = shutdown;
  function requestShutdown(): void {
    shutdown.abort();
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
    if (process.send && !process.connected) return;
    await boss.start({ attempts: 3 });
    if (signal.aborted) return;
    await boss.createQueue(workerProbeQueue, {
      expireInSeconds: 10,
      retentionSeconds: 120,
      deleteAfterSeconds: 120,
      retryLimit: 2,
      retryDelay: 1,
      retryBackoff: true,
      retryDelayMax: 4,
    });
    if (signal.aborted) return;
    await boss.work<WorkerProbe, WorkerProbe | undefined>(
      workerProbeQueue,
      { pollingIntervalSeconds: 1 },
      async ([job]) => job?.data,
    );
    if (!signal.aborted && process.connected) {
      process.send?.({ type: "ready" }, (error) => {
        if (error) requestShutdown();
      });
    }
    await pollFixtureReceipts(signal);
  } finally {
    try {
      try {
        await boss.stop({ graceful: true, timeout: 5_000 });
      } finally {
        await closeRuntime();
      }
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
