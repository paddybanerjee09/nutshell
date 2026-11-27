import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

const env = {
  NUTSHELL_MODE: "local-alpha",
  NUTSHELL_DEPLOYMENT: "local",
  NUTSHELL_ORIGIN: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://test@127.0.0.1:55432/nutshell_alpha",
  TEST_DATABASE_URL: "postgresql://test@127.0.0.1:55432/nutshell_alpha_test",
  BETTER_AUTH_SECRET: "tests-only-value-not-used-for-live-or-demo-sessions",
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
    expect(() => loadConfig({ ...env, NUTSHELL_MODE: "live" })).toThrow(/live GitHub App adapter/u);
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
