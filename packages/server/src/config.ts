import { z } from "zod";
import { isConfiguredSecret, readGitHubAppSettings, type GitHubAppSettings } from "./github-app-settings.ts";

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
const modeSchema = z.enum(["local-alpha", "live"]);
const deploymentSchema = z.enum(["local", "hosted"]);
const verifySchema = z.enum(["0", "1"]).optional();
const databaseNames = ["nutshell_alpha", "nutshell_alpha_test"] as const;
const postgresProtocols = new Set(["postgres:", "postgresql:"]);
const databaseNameOptions = new Set(["database", "dbname"]);
const controlCharacters = /\p{Cc}/u;

export const localSetupConnectionTimeout = 15_000;

type Env = Readonly<Record<string, string | undefined>>;
type Deployment = z.infer<typeof deploymentSchema>;

type CommonConfig = {
  origin: string;
  databaseUrl: string;
  authSecret: string;
};

export type LocalAlphaConfig = CommonConfig & {
  mode: "local-alpha";
  deployment: "local";
  testDatabaseUrl: string;
  webhookSecret?: string;
};

export type LiveConfig = CommonConfig & {
  mode: "live";
  deployment: Deployment;
  githubApp: GitHubAppSettings;
};

export type RuntimeConfig = LocalAlphaConfig | LiveConfig;

function readUrl(value: string | undefined, key: string) {
  try {
    if (!value || value.trim() !== value) throw new Error();
    return new URL(value);
  } catch {
    throw new Error(key + " must be an absolute URL.");
  }
}

function readOrigin(value: string | undefined, mode: RuntimeConfig["mode"]) {
  const url = readUrl(value, "NUTSHELL_ORIGIN");
  const permitted = mode === "local-alpha" ? loopback.has(url.hostname) && url.protocol === "http:"
    : url.protocol === "https:" && !controlCharacters.test(value ?? "");
  if (!permitted || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error(mode === "local-alpha" ? "NUTSHELL_ORIGIN must be a loopback HTTP origin." : "NUTSHELL_ORIGIN must be an HTTPS origin for live mode.");
  }
  return url.origin;
}

export function requireLocalDatabaseUrl(value: string | undefined, key: string, database?: typeof databaseNames[number]) {
  const url = readUrl(value, key);
  const allowedNames = database ? [database] : databaseNames;
  if (
    !loopback.has(url.hostname) || !postgresProtocols.has(url.protocol) ||
    !url.username || !allowedNames.some((name) => url.pathname === "/" + name) || url.search || url.hash
  ) {
    throw new Error(key + " must target a dedicated local PostgreSQL database (" + allowedNames.join(" or ") + ").");
  }
  return url.href;
}

export function requireLiveDatabaseUrl(value: string | undefined, key = "DATABASE_URL") {
  const url = readUrl(value, key);
  const invalid = `${key} must target an explicitly named PostgreSQL database separate from the local alpha databases.`;
  try {
    // node-postgres decodes the pathname as the database name independently from other URI components.
    const name = decodeURI(url.pathname.slice(1));
    const credentials = [decodeURIComponent(url.username), decodeURIComponent(url.password), decodeURIComponent(url.hostname)];
    const invalidOption = Array.from(url.searchParams).some(([option, argument]) =>
      databaseNameOptions.has(option.toLowerCase()) || controlCharacters.test(option) || controlCharacters.test(argument));
    if (!postgresProtocols.has(url.protocol) || !url.hostname || !url.username || !name || url.hash || invalidOption ||
      databaseNames.some((reserved) => reserved === name.toLowerCase()) ||
      [value ?? "", name, ...credentials].some((part) => controlCharacters.test(part))) throw new Error();
  } catch {
    throw new Error(invalid);
  }
  return url.href;
}

function readMode(env: Env) {
  const mode = modeSchema.safeParse(env.NUTSHELL_MODE);
  if (!mode.success) throw new Error("Set NUTSHELL_MODE to local-alpha or live.");
  return mode.data;
}

function readDeployment(env: Env): Deployment {
  const deployment = deploymentSchema.safeParse(env.NUTSHELL_DEPLOYMENT);
  if (!deployment.success) throw new Error("Set NUTSHELL_DEPLOYMENT to local or hosted.");
  return deployment.data;
}

function readVerification(env: Env) {
  const verify = verifySchema.safeParse(env.NUTSHELL_VERIFY);
  if (!verify.success) throw new Error("NUTSHELL_VERIFY must be 0 or 1 when set.");
  return verify.data === "1";
}

function readAuthSecret(env: Env, mode: RuntimeConfig["mode"]) {
  const value = env.BETTER_AUTH_SECRET;
  if (!value || (mode === "live" ? !isConfiguredSecret(value, 32) : value.length < 32 || value.trim() !== value)) {
    throw new Error("Set BETTER_AUTH_SECRET to a randomly generated secret of at least 32 characters.");
  }
  return value;
}

function localConfig(env: Env, deployment: Deployment): LocalAlphaConfig {
  if (deployment !== "local") throw new Error("Local-alpha mode requires a local deployment.");
  const verify = readVerification(env);
  const origin = readOrigin(env.NUTSHELL_ORIGIN, "local-alpha");
  const developmentDatabaseUrl = requireLocalDatabaseUrl(env.DATABASE_URL, "DATABASE_URL", "nutshell_alpha");
  const testDatabaseUrl = requireLocalDatabaseUrl(env.TEST_DATABASE_URL, "TEST_DATABASE_URL", "nutshell_alpha_test");
  const authSecret = readAuthSecret(env, "local-alpha");
  const webhookSecret = env.NUTSHELL_WEBHOOK_SECRET || undefined;
  if (webhookSecret && (webhookSecret.length < 32 || webhookSecret.length > 1024 || webhookSecret.trim() !== webhookSecret)) {
    throw new Error("Set NUTSHELL_WEBHOOK_SECRET to a randomly generated secret of 32 to 1024 characters.");
  }
  return {
    mode: "local-alpha",
    deployment,
    origin,
    databaseUrl: verify ? testDatabaseUrl : developmentDatabaseUrl,
    testDatabaseUrl,
    authSecret,
    webhookSecret,
  };
}

function liveConfig(env: Env, deployment: Deployment): LiveConfig {
  if (readVerification(env)) throw new Error("NUTSHELL_VERIFY cannot enable fixture verification in live mode.");
  return {
    mode: "live",
    deployment,
    origin: readOrigin(env.NUTSHELL_ORIGIN, "live"),
    databaseUrl: requireLiveDatabaseUrl(env.DATABASE_URL),
    authSecret: readAuthSecret(env, "live"),
    githubApp: readGitHubAppSettings(env),
  };
}

export function loadConfig(env: Env = process.env): RuntimeConfig {
  const mode = readMode(env);
  const deployment = readDeployment(env);
  return mode === "local-alpha" ? localConfig(env, deployment) : liveConfig(env, deployment);
}

export function loadLocalConfig(env: Env = process.env): LocalAlphaConfig {
  if (readMode(env) !== "local-alpha") throw new Error("This operation requires local-alpha mode.");
  return localConfig(env, readDeployment(env));
}
