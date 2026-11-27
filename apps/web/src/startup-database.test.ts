import { describe, expect, it, vi } from "vitest";
import { waitForStartupDatabase } from "./startup-database.ts";

describe("local web startup database readiness", () => {
  const timeout = new Error("Readiness query failed", { cause: new Error("timeout expired") });

  it("recovers from a wrapped transient connection timeout", async () => {
    const check = vi.fn<() => Promise<void>>().mockRejectedValueOnce(timeout).mockResolvedValueOnce(undefined);
    await waitForStartupDatabase(check, new AbortController().signal);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stops after three failed connection attempts", async () => {
    const check = vi.fn<() => Promise<void>>().mockRejectedValue(timeout);
    await expect(waitForStartupDatabase(check, new AbortController().signal)).rejects.toBe(timeout);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("fails on a permanent error and honors an abort before another attempt", async () => {
    const permanent = Object.assign(new Error("Invalid database credentials"), { code: "28P01" });
    const invalid = vi.fn<() => Promise<void>>().mockRejectedValue(permanent);
    await expect(waitForStartupDatabase(invalid, new AbortController().signal)).rejects.toBe(permanent);
    expect(invalid).toHaveBeenCalledTimes(1);

    const shutdown = new AbortController();
    const check = vi.fn(async () => {
      shutdown.abort();
      throw timeout;
    });
    await expect(waitForStartupDatabase(check, shutdown.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(check).toHaveBeenCalledTimes(1);
  });
});
