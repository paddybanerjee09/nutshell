import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PgBoss } from "pg-boss";

export const workerProbeQueue = "nutshell.worker-probe";

export interface WorkerProbe {
  nonce: string;
}

export async function runWorkerProbe(databaseUrl: string): Promise<void> {
  const connection = {
    connectionString: databaseUrl,
    application_name: "nutshell-worker-probe",
    connectionTimeoutMillis: 2_000,
    // pg-boss forwards connection settings to node-postgres.
    query_timeout: 3_000,
    options: "-c statement_timeout=2500",
    migrate: false,
    registerInstance: false,
    schedule: false,
    supervise: false,
  };
  const boss = new PgBoss(connection);
  // A dropped pool connection is observed by the job lookup and its retry limit.
  boss.on("error", () => {});

  try {
    await boss.start({ attempts: 2 });
    const payload: WorkerProbe = { nonce: randomUUID() };
    const id = await boss.send(workerProbeQueue, payload);
    if (!id) throw new Error("The worker probe could not be queued.");

    const deadline = performance.now() + 15_000;
    let readFailures = 0;
    while (performance.now() < deadline) {
      const jobs = await boss.findJobs(workerProbeQueue, { id, limit: 1 }).catch(() => null);
      if (jobs === null && ++readFailures > 2) {
        throw new Error("The worker probe lost its database connection.");
      }

      const job = jobs?.[0];
      if (job?.state === "completed") {
        if (!job.output || !("nonce" in job.output) || job.output.nonce !== payload.nonce) {
          throw new Error("The worker probe returned an unexpected result.");
        }
        return;
      }
      if (job?.state === "failed" || job?.state === "cancelled") {
        throw new Error(`The worker probe ${job.state}.`);
      }
      await delay(200);
    }
    throw new Error("The worker did not complete the probe within 15 seconds.");
  } finally {
    await boss.stop({ graceful: false });
  }
}
