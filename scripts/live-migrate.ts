import { loadConfig } from "@nutshell/server/config";
import { migrateLiveDatabase } from "@nutshell/server/setup";

try {
  const config = loadConfig();
  if (config.mode !== "live") throw new Error("Live migrations require explicit live mode.");
  await migrateLiveDatabase(config.databaseUrl);
  console.log("Nutshell live schema migrations completed.");
} catch {
  console.error("Live migrations failed. Check the configured GitHub App mode, database, and migration privileges.");
  process.exitCode = 1;
}
