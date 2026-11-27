import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadConfig, loadLocalConfig, requireLiveDatabaseUrl } from "./config.ts";

const env = {
  NUTSHELL_MODE: "local-alpha",
  NUTSHELL_DEPLOYMENT: "local",
  NUTSHELL_ORIGIN: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://test@127.0.0.1:55432/nutshell_alpha",
  TEST_DATABASE_URL: "postgresql://test@127.0.0.1:55432/nutshell_alpha_test",
  BETTER_AUTH_SECRET: "tests-only-value-not-used-for-live-or-demo-sessions",
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const liveEnv = {
  NUTSHELL_MODE: "live",
  NUTSHELL_DEPLOYMENT: "hosted",
  NUTSHELL_ORIGIN: "https://nutshell.example.test",
  DATABASE_URL: "postgresql://fixture@database.example.test/configured_nutshell?sslmode=verify-full",
  BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  GITHUB_APP_ID: "4785",
  GITHUB_APP_CLIENT_ID: "Iv1.controlled-config",
  GITHUB_APP_CLIENT_SECRET: "only-a-controlled-config-client-secret",
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
  GITHUB_APP_WEBHOOK_SECRET: "only-a-controlled-config-webhook-secret",
};

describe("local runtime configuration", () => {
  it("accepts the dedicated local database for an optimized alpha", () => {
    expect(loadConfig({ ...env, NODE_ENV: "production" })).toMatchObject({
      mode: "local-alpha",
      deployment: "local",
      origin: env.NUTSHELL_ORIGIN,
      databaseUrl: env.DATABASE_URL,
      testDatabaseUrl: env.TEST_DATABASE_URL,
    });
  });

  it("selects only the validated test database on explicit verification", () => {
    expect(loadConfig({ ...env, NUTSHELL_VERIFY: "1" }).databaseUrl).toBe(env.TEST_DATABASE_URL);
    expect(() => loadConfig({ ...env, NUTSHELL_VERIFY: "yes" })).toThrow(/NUTSHELL_VERIFY/u);
    expect(() => loadConfig({ ...env, TEST_DATABASE_URL: env.DATABASE_URL })).toThrow(/TEST_DATABASE_URL/u);
  });

  it("requires explicit modes and refuses hosted fixture access", () => {
    expect(() => loadConfig({ ...env, NUTSHELL_MODE: undefined })).toThrow(/NUTSHELL_MODE/u);
    expect(() => loadConfig({ ...env, NUTSHELL_DEPLOYMENT: undefined })).toThrow(/NUTSHELL_DEPLOYMENT/u);
    expect(() => loadConfig({ ...env, NUTSHELL_DEPLOYMENT: "hosted" })).toThrow(/requires a local deployment/u);
    expect(() => loadConfig({ ...env, NUTSHELL_MODE: "live" })).toThrow(/HTTPS origin for live mode/u);
    expect(() => loadLocalConfig({ NUTSHELL_MODE: "live" })).toThrow(/requires local-alpha mode/u);
  });

  it("requires a loopback origin and refuses PostgreSQL URL overrides", () => {
    expect(() => loadConfig({ ...env, NUTSHELL_ORIGIN: "http://127.0.0.1.example:3000" })).toThrow(/loopback/u);
    expect(() => loadConfig({ ...env, NUTSHELL_ORIGIN: "https://127.0.0.1:3000" })).toThrow(/loopback HTTP/u);
    expect(() => loadConfig({ ...env, NUTSHELL_ORIGIN: "http://127.0.0.1:3000/hidden" })).toThrow(/loopback/u);
    expect(() => loadConfig({ ...env, DATABASE_URL: env.DATABASE_URL + "?host=elsewhere.example" }))
      .toThrow(/DATABASE_URL/u);
  });

  it("reports invalid secrets and database settings without echoing them", () => {
    expect(() => loadConfig({ ...env, BETTER_AUTH_SECRET: "too-short" })).toThrow(/^Set BETTER_AUTH_SECRET/u);
    expect(() => loadConfig({ ...env, DATABASE_URL: "postgresql://test:bad-password@outside/nutshell_alpha" }))
      .toThrow(/^DATABASE_URL must target/u);
  });
});

describe("configured GitHub App runtime", () => {
  it("accepts explicit HTTPS and named PostgreSQL settings without alpha-only data", () => {
    expect(loadConfig({ ...liveEnv, TEST_DATABASE_URL: env.TEST_DATABASE_URL, NUTSHELL_WEBHOOK_SECRET: "unused" })).toEqual({
      mode: "live", deployment: "hosted", origin: liveEnv.NUTSHELL_ORIGIN, databaseUrl: liveEnv.DATABASE_URL,
      authSecret: liveEnv.BETTER_AUTH_SECRET,
      githubApp: {
        appId: liveEnv.GITHUB_APP_ID, clientId: liveEnv.GITHUB_APP_CLIENT_ID, clientSecret: liveEnv.GITHUB_APP_CLIENT_SECRET,
        privateKey: liveEnv.GITHUB_APP_PRIVATE_KEY.trim(), webhookSecret: liveEnv.GITHUB_APP_WEBHOOK_SECRET,
      },
    });
    expect(loadConfig({ ...liveEnv, NUTSHELL_DEPLOYMENT: "local", NUTSHELL_VERIFY: "0" })).toMatchObject({ mode: "live", deployment: "local" });
    expect(loadLocalConfig(env).mode).toBe("local-alpha");
  });

  it("requires every App credential independently of fixture or source credentials", () => {
    for (const key of Object.keys(liveEnv).filter((name) => name.startsWith("GITHUB_APP_"))) {
      expect(() => loadConfig({ ...liveEnv, [key]: undefined, NUTSHELL_WEBHOOK_SECRET: "unused-fixture-value-0123456789", GH_TOKEN: "unused-source-value" }))
        .toThrow(new RegExp(key, "u"));
    }
    expect(() => loadConfig({ ...liveEnv, GITHUB_APP_PRIVATE_KEY: "invalid-key-content" })).toThrow(/^GITHUB_APP_PRIVATE_KEY must be an unencrypted RSA private key of at least 2048 bits\.$/u);
  });

  it("rejects fixture verification and invalid HTTPS or session settings", () => {
    expect(() => loadConfig({ ...liveEnv, NUTSHELL_VERIFY: "1" })).toThrow(/NUTSHELL_VERIFY.*live mode/u);
    expect(() => loadConfig({ ...liveEnv, NUTSHELL_VERIFY: "yes" })).toThrow(/NUTSHELL_VERIFY/u);
    for (const origin of ["http://nutshell.example.test", "https://nutshell.example.test/ui", "https://name@nutshell.example.test/"]) {
      expect(() => loadConfig({ ...liveEnv, NUTSHELL_ORIGIN: origin })).toThrow(/HTTPS origin for live mode/u);
    }
    expect(() => loadConfig({ ...liveEnv, BETTER_AUTH_SECRET: "a".repeat(1025) })).toThrow(/^Set BETTER_AUTH_SECRET/u);
  });

  it("rejects dedicated alpha databases, ambiguous database options, and decoded controls", () => {
    const databasePrefix = "postgresql://fixture:sample-password@database.example.test/";
    for (const url of [env.DATABASE_URL, env.TEST_DATABASE_URL, databasePrefix, databasePrefix + "%6eutshell_alpha",
      databasePrefix + "NUTSHELL_ALPHA_TEST", databasePrefix + "nutshell_alpha%00other", databasePrefix + "other?%64atabase=nutshell_alpha",
      databasePrefix + "other?application_name=with%00control", "https://database.example.test/other"]) {
      expect(() => loadConfig({ ...liveEnv, DATABASE_URL: url }))
        .toThrow(/^DATABASE_URL must target an explicitly named PostgreSQL database separate from the local alpha databases\.$/u);
    }
    expect(() => requireLiveDatabaseUrl(env.DATABASE_URL, "Migration target")).toThrow(/^Migration target must target/u);
    expect(requireLiveDatabaseUrl(liveEnv.DATABASE_URL, "Migration target")).toBe(liveEnv.DATABASE_URL);
  });
});
