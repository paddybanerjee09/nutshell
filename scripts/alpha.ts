import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { loadLocalConfig } from "@nutshell/server/config";
import { ensureLocalDatabase } from "@nutshell/server/provision";
import { migrateAndSeed } from "@nutshell/server/setup";
import { resetVerificationFixtures, withVerificationLock } from "@nutshell/server/verification-reset";
import { runWorkerProbe } from "../apps/worker/src/probe.ts";
import { verifyEntryFlow } from "./local-browser.ts";
import { loadLocalEnv } from "./local-env.ts";
import { runDevelopment, startServices, stopDevelopment } from "./local-services.ts";

async function prepare(databaseUrl: string) {
  await ensureLocalDatabase(databaseUrl);
  await migrateAndSeed(databaseUrl);
}

async function runPnpm(args: string[], env: NodeJS.ProcessEnv = process.env) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error("Run the local alpha commands through pnpm.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { stdio: "inherit", env });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("pnpm " + args.join(" ") + " failed."));
    });
  });
}

async function verify(scope: "all" | "worker" = "all", bundler: "default" | "webpack" = "default") {
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NUTSHELL_VERIFY: "1",
    NUTSHELL_ORIGIN: "http://127.0.0.1:3001",
  };
  const config = loadLocalConfig(env);
  await ensureLocalDatabase(config.testDatabaseUrl);
  await withVerificationLock(config.testDatabaseUrl, async (client) => {
    await migrateAndSeed(config.testDatabaseUrl);
    if (scope === "all") {
      await runPnpm(["lint"]);
      await runPnpm(["typecheck"]);
      // The suites share synthetic PostgreSQL state. Windows uses threads to avoid fork teardown delays.
      const testArgs = ["test", "--no-file-parallelism"];
      if (process.platform === "win32") testArgs.push("--pool=threads");
      await runPnpm(testArgs, env);
      const buildArgs = bundler === "webpack" ? ["exec", "next", "build", "--webpack"] : ["build"];
      await runPnpm(["--filter", "@nutshell/web", ...buildArgs], env);
    }

    const web = await startServices(env, true, undefined, "web");
    let worker: Awaited<ReturnType<typeof startServices>> | undefined;
    try {
      worker = await startServices(env, true, undefined, "worker");
      await runWorkerProbe(config.databaseUrl);
      console.log("The worker completed a persisted job in the dedicated verification database.");
      await worker.stop();

      const deliveryId = randomUUID();
      const revision = randomBytes(20).toString("hex");
      await promisify(execFile)(process.execPath, ["scripts/fixture-worker-offline.ts", revision, deliveryId], { env, timeout: 45_000 });
      const readDelivery = async () => {
        const { rows } = await client.query<{ status: string; attempts: number; indexed_revision: string | null }>(
          `SELECT d.status, d.attempts, s.indexed_revision FROM fixture_delivery d
           JOIN fixture_state s ON s.repository_id = d.repository_id
           WHERE d.id = $1 AND d.revision = $2 AND d.repository_id = 1001 AND d.installation_id = 2001`,
          [deliveryId, revision],
        );
        const [receipt] = rows;
        assert.ok(receipt && rows.length === 1, "Expected the exact durable delivery in the verification database.");
        return receipt;
      };
      assert.deepEqual(await readDelivery(), { status: "queued", attempts: 0, indexed_revision: null },
        "The running web process must persist the signed receipt while the worker is stopped.");
      worker = await startServices(env, true, undefined, "worker");
      const deadline = performance.now() + 50_000;
      let delivery = await readDelivery();
      while (delivery.status === "queued" && performance.now() < deadline) {
        await delay(250);
        delivery = await readDelivery();
      }
      assert.deepEqual(delivery, { status: "published", attempts: 1, indexed_revision: revision },
        "A new worker must publish the exact queued revision on its first attempt.");
      console.log("The restarted worker recovered the signed receipt and published its exact revision.");

      if (scope === "all") {
        await runPnpm(["exec", "node", "scripts/fixture-onboarding-prepare.ts"], env);
        await verifyEntryFlow(config.origin);
        await runPnpm(["exec", "node", "scripts/fixture-sync-verify.ts"], env);
      }
    } finally {
      try {
        await worker?.stop();
      } finally {
        await web.stop();
      }
    }
  });
}

try {
  switch (process.argv[2]) {
    case "setup": {
      loadLocalEnv(true);
      const config = loadLocalConfig({ ...process.env, NUTSHELL_VERIFY: "0" });
      await prepare(config.databaseUrl);
      await ensureLocalDatabase(config.testDatabaseUrl);
      await withVerificationLock(config.testDatabaseUrl, () => migrateAndSeed(config.testDatabaseUrl));
      console.log("Local PostgreSQL migrations and fixture setup completed.");
      break;
    }
    case "dev":
      loadLocalEnv(false);
      await runDevelopment({ ...process.env, NEXT_TELEMETRY_DISABLED: "1", NUTSHELL_VERIFY: "0" });
      break;
    case "verify": {
      const args = process.argv.slice(3);
      if (args.length > 1 || (args.length === 1 && args[0] !== "--webpack")) {
        throw new Error("Run alpha:verify with no arguments or with --webpack.");
      }
      loadLocalEnv(false);
      await verify("all", args[0] === "--webpack" ? "webpack" : "default");
      break;
    }
    case "verify-worker":
      loadLocalEnv(false);
      await verify("worker");
      break;
    case "reset": {
      if (process.argv.length !== 3) throw new Error("Run alpha:reset without a database or resource argument.");
      loadLocalEnv(false);
      const config = loadLocalConfig({ ...process.env, NUTSHELL_VERIFY: "1" });
      await resetVerificationFixtures(config.testDatabaseUrl);
      console.log("Generated verification fixture state was reset.");
      break;
    }
    case "stop":
      await stopDevelopment();
      break;
    default:
      throw new Error("Expected setup, dev, verify, verify-worker, reset, or stop.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Nutshell alpha command failed.");
  process.exitCode = 1;
}
