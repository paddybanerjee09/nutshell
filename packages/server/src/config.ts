import { z } from "zod";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const modeSchema = z.enum(["local-alpha", "live"]);
const deploymentSchema = z.enum(["local", "hosted"]);
const verifySchema = z.enum(["0", "1"]).optional();
const databaseNames = ["nutshell_alpha", "nutshell_alpha_test"] as const;

type Env = Readonly<Record<string, string | undefined>>;

export type RuntimeConfig = {
  mode: "local-alpha" | "live";
  deployment: "local" | "hosted";
  origin: string;
  databaseUrl: string;
  testDatabaseUrl: string;
  authSecret: string;
};

function readUrl(value: string | undefined, key: string) {
  try {
    if (!value || value.trim() !== value) throw new Error();
    return new URL(value);
  } catch {
    throw new Error(key + " must be an absolute URL.");
  }
}

function readOrigin(value: string | undefined) {
  const url = readUrl(value, "NUTSHELL_ORIGIN");
  if (
    !loopback.has(url.hostname) || url.protocol !== "http:" ||
    url.pathname !== "/" || url.username || url.password || url.search || url.hash
  ) {
    throw new Error("NUTSHELL_ORIGIN must be a loopback HTTP origin.");
  }
  return url.origin;
}

export function requireLocalDatabaseUrl(value: string | undefined, key: string, database?: typeof databaseNames[number]) {
  const url = readUrl(value, key);
  const allowedNames = database ? [database] : databaseNames;
  if (
    !loopback.has(url.hostname) || !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.username || !allowedNames.some((name) => url.pathname === "/" + name) || url.search || url.hash
  ) {
    throw new Error(key + " must target a dedicated local PostgreSQL database (" + allowedNames.join(" or ") + ").");
  }
  return url.href;
}

export function loadConfig(env: Env = process.env): RuntimeConfig {
  const mode = modeSchema.safeParse(env.NUTSHELL_MODE);
  if (!mode.success) throw new Error("Set NUTSHELL_MODE to local-alpha or live.");
  const deployment = deploymentSchema.safeParse(env.NUTSHELL_DEPLOYMENT);
  if (!deployment.success) throw new Error("Set NUTSHELL_DEPLOYMENT to local or hosted.");
  if (mode.data === "live") {
    throw new Error("The live GitHub App adapter is unavailable in this runtime.");
  }
  if (deployment.data !== "local") {
    throw new Error("Local-alpha mode requires a local deployment.");
  }
  const verify = verifySchema.safeParse(env.NUTSHELL_VERIFY);
  if (!verify.success) throw new Error("NUTSHELL_VERIFY must be 0 or 1 when set.");

  const origin = readOrigin(env.NUTSHELL_ORIGIN);
  const developmentDatabaseUrl = requireLocalDatabaseUrl(env.DATABASE_URL, "DATABASE_URL", "nutshell_alpha");
  const testDatabaseUrl = requireLocalDatabaseUrl(env.TEST_DATABASE_URL, "TEST_DATABASE_URL", "nutshell_alpha_test");
  const authSecret = env.BETTER_AUTH_SECRET;
  if (!authSecret || authSecret.length < 32 || authSecret.trim() !== authSecret) {
    throw new Error("Set BETTER_AUTH_SECRET to a randomly generated secret of at least 32 characters.");
  }
  return {
    mode: mode.data,
    deployment: deployment.data,
    origin,
    databaseUrl: verify.data === "1" ? testDatabaseUrl : developmentDatabaseUrl,
    testDatabaseUrl,
    authSecret,
  };
}
