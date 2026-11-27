import { spawn } from "node:child_process";
import { loadConfig } from "@nutshell/server/config";
import { ensureLocalDatabase } from "@nutshell/server/provision";
import { migrateAndSeed } from "@nutshell/server/setup";
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

async function verify() {
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NUTSHELL_VERIFY: "1",
    NUTSHELL_ORIGIN: "http://127.0.0.1:3001",
  };
  const config = loadConfig(env);
  await prepare(config.testDatabaseUrl);
  await runPnpm(["lint"]);
  await runPnpm(["typecheck"]);
  await runPnpm(["test", "--no-file-parallelism"], env);
  await runPnpm(["--filter", "@nutshell/web", "build"], env);
  await runPnpm(["exec", "node", "scripts/fixture-onboarding-prepare.ts"], env);
  const services = await startServices(env, true);
  try {
    await runWorkerProbe(config.databaseUrl);
    console.log("The worker completed a persisted job in the dedicated verification database.");
    await verifyEntryFlow(config.origin);
    await runPnpm(["exec", "node", "scripts/fixture-sync-verify.ts"], env);
  } finally {
    await services.stop();
  }
}

try {
  switch (process.argv[2]) {
    case "setup": {
      loadLocalEnv(true);
      const config = loadConfig({ ...process.env, NUTSHELL_VERIFY: "0" });
      await prepare(config.databaseUrl);
      await prepare(config.testDatabaseUrl);
      console.log("Local PostgreSQL migrations and fixture setup completed.");
      break;
    }
    case "dev":
      loadLocalEnv(false);
      await runDevelopment({ ...process.env, NEXT_TELEMETRY_DISABLED: "1", NUTSHELL_VERIFY: "0" });
      break;
    case "verify":
      loadLocalEnv(false);
      await verify();
      break;
    case "stop":
      await stopDevelopment();
      break;
    default:
      throw new Error("Expected setup, dev, verify, or stop.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Nutshell alpha command failed.");
  process.exitCode = 1;
}
