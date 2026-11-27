import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadConfig } from "@nutshell/server/config";

export function loadLocalEnv(create: boolean) {
  if (create && !existsSync(".env")) {
    const urls = databaseUrls();
    const config = {
      NUTSHELL_MODE: process.env.NUTSHELL_MODE ?? "local-alpha",
      NUTSHELL_DEPLOYMENT: process.env.NUTSHELL_DEPLOYMENT ?? "local",
      NUTSHELL_ORIGIN: process.env.NUTSHELL_ORIGIN ?? "http://127.0.0.1:3000",
      DATABASE_URL: urls.databaseUrl,
      TEST_DATABASE_URL: urls.testDatabaseUrl,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || randomBytes(32).toString("base64url"),
    };
    loadConfig(config);
    const rows = Object.entries(config).map(([key, value]) => key + "=" + JSON.stringify(value));
    writeFileSync(".env", rows.join("\n") + "\n", { flag: "wx", mode: 0o600 });
  }
  if (existsSync(".env")) {
    process.loadEnvFile(".env");
    if (create && !process.env.BETTER_AUTH_SECRET) {
      const secret = randomBytes(32).toString("base64url");
      loadConfig({ ...process.env, BETTER_AUTH_SECRET: secret });
      const existing = readFileSync(".env", "utf8");
      const blankSecret = /^BETTER_AUTH_SECRET=\s*$/m;
      if (blankSecret.test(existing)) {
        writeFileSync(".env", existing.replace(blankSecret, "BETTER_AUTH_SECRET=" + secret + "\n"), { mode: 0o600 });
      } else {
        appendFileSync(".env", "\nBETTER_AUTH_SECRET=" + secret + "\n", { mode: 0o600 });
      }
      process.env.BETTER_AUTH_SECRET = secret;
    }
  }
}

function databaseUrls() {
  const { DATABASE_URL: databaseUrl, TEST_DATABASE_URL: testDatabaseUrl } = process.env;
  if (databaseUrl && testDatabaseUrl) return { databaseUrl, testDatabaseUrl };
  const portable = ".local/postgres-18.7/pgpass.conf";
  if (!databaseUrl && !testDatabaseUrl && existsSync(portable)) {
    const [row, password] = /^127\.0\.0\.1:55432:(?:\*|postgres):nutshell_local:([A-Za-z0-9_-]+)$/m.exec(
      readFileSync(portable, "utf8").replaceAll("\r\n", "\n"),
    ) ?? [];
    if (row && password) {
      const loopback = new URL("postgresql://nutshell_local@127.0.0.1:55432");
      loopback.password = password;
      return { databaseUrl: loopback.href + "/nutshell_alpha", testDatabaseUrl: loopback.href + "/nutshell_alpha_test" };
    }
  }
  throw new Error("Set DATABASE_URL and TEST_DATABASE_URL to the dedicated local PostgreSQL databases before running setup.");
}
