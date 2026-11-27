import { setTimeout as delay } from "node:timers/promises";

const retryableCodes = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P03"]);
const retryableMessages = new Set(["timeout expired", "Connection terminated due to connection timeout"]);

function transientConnectionError(error: unknown) {
  for (let depth = 0; depth < 4 && error instanceof Error; depth++) {
    const code = "code" in error ? error.code : undefined;
    if ((typeof code === "string" && retryableCodes.has(code)) || retryableMessages.has(error.message) || error.name === "TimeoutError") return true;
    error = error.cause;
  }
  return false;
}

export async function waitForStartupDatabase(check: () => Promise<boolean | void>, signal: AbortSignal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      if (await check() !== false) return;
    } catch (error) {
      if (attempt === 2 || !transientConnectionError(error)) throw error;
    }
    if (attempt < 2) await delay(250 * (attempt + 1), undefined, { signal });
  }
  throw new Error("PostgreSQL remained unavailable after three web readiness checks.");
}
