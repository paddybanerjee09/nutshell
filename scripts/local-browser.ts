import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";

const personaPath = "/api/auth/nutshell/persona";

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
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
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
    console.log("Browser entry, session reload, and repository isolation passed.");
  } finally {
    await browser.close();
  }
}
