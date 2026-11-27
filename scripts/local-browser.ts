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

async function verifySetup(page: Page, origin: string) {
  const setupPath = "/api/repos/1001/setup";
  const setup = page.getByRole("region", { name: "Repository setup" });
  const endpoint = origin + setupPath;
  const responseFor = () => page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && new URL(candidate.url()).pathname === setupPath);
  const post = (data: object, requestOrigin = origin) => page.request.post(endpoint, { headers: { origin: requestOrigin }, data });

  assert.equal((await post({ action: "open" }, "https://untrusted.invalid")).status(), 403);
  const creation = responseFor();
  await setup.getByRole("button", { name: "Create setup proposal" }).click();
  const result = await creation;
  assert.equal(result.status(), 200);
  const { proposal } = await result.json() as { proposal: { id: string; headRevision: string } };
  assert.ok(proposal.id);
  assert.match(proposal.headRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  await setup.getByRole("heading", { name: "Awaiting setup merge" }).waitFor();
  const duplicate = await post({ action: "open" });
  assert.equal(duplicate.status(), 200);
  assert.deepEqual((await duplicate.json()).proposal, proposal);
  assert.equal((await post({ action: "merge", expectedHead: "0".repeat(40) })).status(), 409);

  const merge = responseFor();
  await setup.getByRole("button", { name: "Simulate setup merge" }).click();
  const merged = await merge;
  assert.equal(merged.status(), 200);
  const { proposal: mergedProposal } = await merged.json() as { proposal: { mergeRevision: string } };
  assert.match(mergedProposal.mergeRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  const repeatedMerge = await post({ action: "merge", expectedHead: proposal.headRevision });
  assert.equal(repeatedMerge.status(), 200);
  assert.deepEqual((await repeatedMerge.json()).proposal, mergedProposal);
  await setup.getByRole("heading", { name: "Repository synced" }).waitFor({ timeout: 35_000 });

  const resultSnapshot = await page.request.get(origin + "/api/repos/1001/snapshot");
  assert.equal(resultSnapshot.status(), 200);
  const snapshot = await resultSnapshot.json();
  assert.equal(snapshot.status, "current");
  assert.equal(snapshot.revision, mergedProposal.mergeRevision);
  assert.ok(snapshot.snapshot.entities.length > 0);
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
    await verifySetup(page, origin);
    await page.screenshot({ path: output + "/fixture-setup-desktop.png" });
    const denied = await page.goto(origin + "/app/repos/1002");
    assert.equal(denied?.status(), 404);
    assert.equal(await page.getByText("Harbor Atlas").count(), 0);

    const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await other.goto(origin + "/login");
    await other.screenshot({ path: output + "/login-mobile.png" });
    await signIn(other, /^Other repository user/);
    await other.getByRole("link", { name: /Harbor Atlas/ }).waitFor();
    assert.equal(await other.getByText("Field Notes").count(), 0);
    assert.equal((await other.request.get(origin + "/api/repos/1001/setup")).status(), 404);

    const reader = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await reader.goto(origin + "/login");
    await signIn(reader, /^Reader/);
    await reader.getByRole("link", { name: /Field Notes/ }).click();
    await reader.getByRole("region", { name: "Repository setup" }).waitFor();
    await reader.getByRole("heading", { name: "Repository synced" }).waitFor();
    assert.equal(await reader.getByRole("button", { name: /Create setup proposal|Simulate setup merge/ }).count(), 0);
    assert.ok(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const forbidden = await reader.request.post(origin + "/api/repos/1001/setup", {
      headers: { origin }, data: { action: "open" },
    });
    assert.equal(forbidden.status(), 403);
  } finally {
    await stopVerificationBrowser(server);
  }
  console.log(`${browserType.name()} entry, session reload, repository isolation, simulated setup and signed publication, and browser shutdown passed.`);
}
