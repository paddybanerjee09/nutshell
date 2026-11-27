import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserServer, Page } from "playwright";

const personaPath = "/api/auth/nutshell/persona";

async function waitForBrowserClose(closed: Promise<boolean>, timeout: number) {
  const deadline = new AbortController();
  try {
    return await Promise.race([closed, delay(timeout, false, { signal: deadline.signal })]);
  } finally {
    deadline.abort();
  }
}

async function stopVerificationBrowser(server: BrowserServer) {
  const closed = server.close().then(() => true, () => false);
  if (await waitForBrowserClose(closed, 30_000)) return;

  // Playwright's Windows force-kill calls taskkill synchronously. Use the
  // already-owned child handle so the termination deadline stays effective.
  const child = server.process();
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  if (await waitForBrowserClose(closed, 10_000)) {
    throw new Error("The verification browser required forced termination.");
  }
  child.unref();
  throw new Error("Verification browser teardown timed out.");
}

async function signIn(page: Page, button: RegExp) {
  const response = page.waitForResponse((candidate) => {
    return candidate.request().method() === "POST" && new URL(candidate.url()).pathname === personaPath;
  });
  await page.getByRole("button", { name: button }).click();
  assert.equal((await response).status(), 200, "The local persona endpoint must accept the same-origin browser request.");
  await page.waitForURL("**/app");
}

export async function verifyEntryFlow(origin: string) {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".local/playwright-preflight/browsers")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".local/playwright-preflight/browsers");
  }
  const { chromium, firefox } = await import("playwright");
  const browserType = process.platform === "win32" ? firefox : chromium;
  const server = await browserType.launchServer({ headless: true, host: "127.0.0.1", timeout: 30_000 });
  try {
    const browser = await browserType.connect(server.wsEndpoint(), { timeout: 10_000 });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const output = ".local/verification";
    await mkdir(output, { recursive: true });
    const health = await page.request.get(origin + "/api/health");
    assert.equal(health.status(), 200);
    const protectedPage = await page.request.get(origin + "/app", { maxRedirects: 0 });
    assert.equal(new URL(protectedPage.headers().location ?? "/", origin).pathname, "/login");
    const crossOrigin = await page.request.post(origin + personaPath, {
      headers: { origin: "https://untrusted.invalid" },
      data: { persona: "coordinator" },
    });
    assert.equal(crossOrigin.status(), 403);
    await page.goto(origin);
    assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "Your codebase. In a Nutshell.");
    await page.screenshot({ path: output + "/entry-desktop.png" });
    await page.getByRole("link", { name: "Open local alpha" }).click();
    await signIn(page, /^Coordinator/);
    await page.getByRole("link", { name: /Field Notes/ }).waitFor();
    assert.equal(await page.getByText("Harbor Atlas").count(), 0);
    await page.reload();
    await page.getByRole("link", { name: /Field Notes/ }).click();
    await page.waitForURL("**/app/repos/1001");
    await page.getByRole("heading", { name: "Field Notes" }).waitFor();
    const denied = await page.goto(origin + "/app/repos/1002");
    assert.equal(denied?.status(), 404);
    assert.equal(await page.getByText("Harbor Atlas").count(), 0);

    const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await other.goto(origin + "/login");
    await other.screenshot({ path: output + "/login-mobile.png" });
    await signIn(other, /^Other repository user/);
    await other.getByRole("link", { name: /Harbor Atlas/ }).waitFor();
    assert.equal(await other.getByText("Field Notes").count(), 0);
  } finally {
    await stopVerificationBrowser(server);
  }
  console.log(`${browserType.name()} entry, session reload, repository isolation, and browser shutdown passed.`);
}
