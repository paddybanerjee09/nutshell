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
  const control = page.getByRole("button", { name: button });
  await control.click({ trial: true });
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === personaPath)
      .catch((error: unknown) => { throw new Error(`Sign-in for ${button.source} did not return a response.`, { cause: error }); }),
    control.click(),
  ]);
  assert.equal(response.status(), 200, "The local persona endpoint must accept the same-origin browser request.");
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
  const create = setup.getByRole("button", { name: "Create setup proposal" });
  await create.click({ trial: true });
  const [result] = await Promise.all([responseFor(), create.click()]);
  assert.equal(result.status(), 200);
  const { proposal } = await result.json() as { proposal: { id: string; headRevision: string } };
  assert.ok(proposal.id);
  assert.match(proposal.headRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  await setup.getByRole("heading", { name: "Awaiting setup merge" }).waitFor();
  const duplicate = await post({ action: "open" });
  assert.equal(duplicate.status(), 200);
  assert.deepEqual((await duplicate.json()).proposal, proposal);
  assert.equal((await post({ action: "merge", expectedHead: "0".repeat(40) })).status(), 409);

  const merge = setup.getByRole("button", { name: "Simulate setup merge" });
  const [merged] = await Promise.all([responseFor(), merge.click()]);
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

async function verifyWorkspace(page: Page, origin: string, output: string) {
  await page.getByRole("link", { name: "Open workspace", exact: true }).click();
  await page.waitForURL("**/app/repos/1001/workspace");
  const controls = page.getByRole("navigation", { name: "Workspace controls" });
  const explorer = page.getByRole("navigation", { name: "Repository explorer" });
  const panes = page.getByRole("region", { name: "Workspace pane" });
  const activePane = page.locator(".workspace-pane[data-focused='true']");
  const workspaceStatus = page.getByTestId("workspace-status");
  await controls.waitFor();
  await explorer.getByRole("button", { name: "nutshell-vault/CURRENT_TASK.md", exact: true }).click();
  await activePane.getByRole("tab", { name: "CURRENT_TASK.md", selected: true }).waitFor();
  await activePane.getByText("No feature task is active.").waitFor();
  assert.equal((await page.locator(".workspace-ribbon").boundingBox())?.width, 40);
  assert.equal((await workspaceStatus.boundingBox())?.height, 24);
  assert.equal(await workspaceStatus.evaluate((node) => getComputedStyle(node).fontSize), "11px");
  const reading = activePane.locator(".workspace-reading");
  assert.deepEqual(await reading.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.fontSize, style.lineHeight, style.maxInlineSize];
  }), ["16px", "25.6px", "700px"]);
  assert.match(await workspaceStatus.innerText(), /Indexed[\s\S]*\d+ backlinks?[\s\S]*\d+ words/u);

  const title = activePane.getByRole("tab", { name: "CURRENT_TASK.md", selected: true });
  await title.focus();
  await page.keyboard.press("Control+P");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands and files" });
  await search.waitFor();
  assert.equal((await palette.boundingBox())?.width, 560);
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "tab");
  await controls.getByRole("button", { name: "Command palette" }).click();
  await search.fill("Field Notes");
  await palette.getByRole("option", { name: /Field Notes/ }).waitFor();
  await page.keyboard.press("Enter");
  await activePane.getByRole("heading", { name: "Field Notes", exact: true }).waitFor();

  await page.keyboard.press("Control+P");
  await search.fill("Move active tab left");
  await palette.getByRole("option", { name: "Move active tab left", exact: true }).waitFor();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const tabs = document.querySelectorAll(".workspace-pane[data-focused='true'] [role='tab']");
    return tabs.length === 3 && tabs[1]?.getAttribute("aria-selected") === "true";
  });

  async function paneAction(name: string) {
    await activePane.locator("summary[aria-label='Pane actions']").click();
    await activePane.getByRole("button", { name, exact: true }).click();
  }
  await paneAction("Split right");
  await page.waitForFunction(() => document.querySelectorAll(".workspace-pane").length === 2);
  await paneAction("Split down");
  await page.waitForFunction(() => document.querySelectorAll(".workspace-pane").length === 3);
  assert.equal(await panes.count(), 3);
  const separator = page.getByRole("separator", { name: "Resize pane split" }).first();
  const originalRatio = await separator.getAttribute("aria-valuenow");
  await separator.focus();
  await separator.press("ArrowRight");
  await page.waitForFunction((before) => document.querySelector("[aria-label='Resize pane split']")?.getAttribute("aria-valuenow") !== before, originalRatio);
  assert.notEqual(await separator.getAttribute("aria-valuenow"), originalRatio);
  await explorer.getByRole("button", { name: "nutshell-vault/CURRENT_TASK.md", exact: true }).click();
  await activePane.getByRole("tab", { name: "CURRENT_TASK.md", selected: true }).waitFor();
  const sourcePane = await activePane.getAttribute("data-pane-id");
  assert.ok(sourcePane);
  await paneAction("Move tab to next pane");
  await page.waitForFunction((source) => document.querySelector(".workspace-pane[data-focused='true']")?.getAttribute("data-pane-id") !== source, sourcePane);
  await activePane.getByRole("tab", { name: "CURRENT_TASK.md", selected: true }).waitFor();
  assert.equal(await page.locator(`[data-pane-id='${sourcePane}']`).getByRole("tab", { name: "CURRENT_TASK.md", exact: true }).count(), 0);
  const left = page.getByRole("complementary", { name: "Left sidebar" });
  const right = page.getByRole("complementary", { name: "Right sidebar" });
  await left.getByRole("button", { name: "Move Explorer to right sidebar" }).click();
  await right.getByRole("navigation", { name: "Repository explorer" }).waitFor();
  await page.reload();
  await right.getByRole("navigation", { name: "Repository explorer" }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll(".workspace-pane").length === 3);
  await activePane.getByRole("tab", { name: "CURRENT_TASK.md", selected: true }).waitFor();

  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [320, 740]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    if (width <= 1024) {
      await page.waitForFunction(() => document.querySelectorAll(".workspace-pane").length === 1);
      await workspaceStatus.getByText("Document counters", { exact: true }).waitFor({ state: width <= 720 ? "visible" : "hidden" });
    }
    await page.screenshot({ path: `${output}/workspace-${width}x${height}.png` });
  }
  await controls.getByRole("button", { name: "Explorer", exact: true }).click();
  await right.getByRole("navigation", { name: "Repository explorer" }).waitFor();
  await right.getByRole("button", { name: "nutshell-vault/_INDEX.md", exact: true }).click();
  await activePane.getByRole("tab", { name: "_INDEX.md", selected: true }).waitFor();
  await paneAction("Split right");
  await page.getByText("This viewport is too small for another visible pane. The current tab stays open.", { exact: true }).waitFor();
  assert.equal(await panes.count(), 1);
  const denied = await page.request.get(origin + "/app/repos/1002/workspace");
  assert.equal(denied.status(), 404);
}

const draftPath = "nutshell-vault/features/nutshell-setup/CONTEXT.md";
const draftRoute = "/api/repos/1001/draft";

async function verifyMarkdownDraft(page: Page, origin: string, output: string) {
  const endpoint = origin + draftRoute;
  const documentUrl = endpoint + "?" + new URLSearchParams({ path: draftPath });
  const original = await page.request.get(documentUrl);
  assert.equal(original.status(), 200);
  assert.equal(original.headers()["cache-control"], "private, no-store");
  const { source, sourceRevision, draft } = await original.json() as {
    source: string; sourceRevision: string; draft: { markdown: string; version: number } | null;
  };
  const base = draft?.markdown ?? source;
  const version = draft?.version ?? 0;
  const ready = await page.goto(origin + "/app/repos/1001/workspace");
  assert.equal(ready?.status(), 200);
  const pane = page.locator(".workspace-pane[data-focused='true']");
  const explorer = page.getByRole("navigation", { name: "Repository explorer" });
  const editor = pane.getByRole("textbox", { name: "Markdown editor" });
  const mac = process.platform === "darwin";
  const documentEnd = mac ? "Meta+ArrowDown" : "Control+End";
  async function openDocument() {
    for (const name of [/^features$/u, /^nutshell-setup$/u]) {
      const folder = explorer.locator("summary").filter({ hasText: name });
      if (!await folder.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)) await folder.click();
    }
    await explorer.getByRole("button", { name: draftPath, exact: true }).click();
  }
  async function paneAction(name: string) {
    await pane.locator("summary[aria-label='Pane actions']").click();
    await pane.getByRole("button", { name, exact: true }).click();
  }

  await openDocument();
  await pane.getByRole("button", { name: "Edit draft", exact: true }).click();
  await pane.getByText("Private draft", { exact: true }).waitFor();
  await editor.waitFor();
  await editor.focus();
  await editor.press(documentEnd);
  const addition = "\n\n## Draft fixture\n\n**認識** e\u0301 🌰 [[_INDEX|Index]]\n\n```txt\n[[literal]]\n```\n";
  const paste = () => editor.evaluate((element, text) => {
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    // Firefox drops the DataTransfer contents on a synthetic ClipboardEvent.
    Object.defineProperty(event, "clipboardData", { value: {
      getData: (format: string) => format === "text/plain" ? text : "",
    } });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, addition);
  const pastedText = editor.locator(".cm-md-heading").filter({ hasText: /^Draft fixture$/u });
  assert.equal(await paste(), true);
  await editor.press(documentEnd);
  await pastedText.waitFor();
  await editor.press(mac ? "Meta+z" : "Control+z");
  await pastedText.waitFor({ state: "hidden" });
  await editor.press(mac ? "Meta+Shift+z" : "Control+y");
  await pastedText.waitFor();
  await pastedText.click();
  await pane.getByText("## Draft fixture", { exact: true }).waitFor();
  await editor.press(documentEnd);
  await pastedText.waitFor();

  await paneAction("Source");
  await pane.getByText("## Draft fixture", { exact: true }).waitFor();
  await paneAction("Live preview");
  await pastedText.waitFor();
  await paneAction("Split right");
  await page.waitForFunction(() => document.querySelectorAll(".workspace-pane").length === 2);
  await openDocument();
  const edit = pane.getByRole("button", { name: "Edit draft", exact: true });
  if (await edit.isVisible()) await edit.click();
  await pane.getByText("Private draft", { exact: true }).waitFor();
  await editor.press(documentEnd);
  await pastedText.waitFor();
  assert.ok(await pane.getByRole("group", { name: "Document view" }).evaluate((bar) => {
    const panel = bar.closest("[role='tabpanel']");
    return panel && bar.getBoundingClientRect().top >= panel.getBoundingClientRect().top;
  }), "The draft status and save control must stay visible when the editor scrolls.");
  await page.screenshot({ path: output + "/markdown-draft-desktop.png" });

  const save = pane.getByRole("button", { name: "Save draft", exact: true });
  const waitForSave = () => page.waitForResponse((candidate) =>
    candidate.request().method() === "PATCH" && new URL(candidate.url()).pathname === draftRoute);
  const [saved] = await Promise.all([waitForSave(), save.click()]);
  assert.equal(saved.status(), 200);
  const savedDraft = (await saved.json()).draft;
  assert.equal(savedDraft.version, version + 1);
  assert.equal(savedDraft.markdown, base + addition);
  const current = async () => (await (await page.request.get(documentUrl)).json());
  assert.equal((await current()).source, source);
  await pane.getByText("Draft saved", { exact: true }).waitFor();

  await page.reload();
  await openDocument();
  await pane.getByRole("button", { name: "Edit draft", exact: true }).click();
  await pane.getByText("Private draft", { exact: true }).waitFor();
  await editor.press(documentEnd);
  await pastedText.waitFor();
  const parallel = { path: draftPath, markdown: savedDraft.markdown + "\nSaved in another tab.\n", sourceRevision, version: savedDraft.version };
  assert.equal((await page.request.patch(endpoint, { headers: { origin: "https://untrusted.invalid" }, data: parallel })).status(), 403);
  assert.equal((await page.request.patch(endpoint, { headers: { origin }, data: parallel })).status(), 200);
  await editor.focus();
  await editor.press(documentEnd);
  await page.keyboard.insertText("Unsaved local text.");
  const [conflict] = await Promise.all([waitForSave(), save.click()]);
  assert.equal(conflict.status(), 409);
  assert.equal((await conflict.json()).reason, "version");
  await pane.getByRole("alert").waitFor();
  await pane.getByText("Unsaved local text.", { exact: true }).waitFor();
  assert.equal((await current()).draft.markdown, parallel.markdown);
  await page.close({ runBeforeUnload: false });
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
    const withoutJavaScript = await browser.newPage({ javaScriptEnabled: false });
    await withoutJavaScript.goto(origin + "/login");
    assert.ok(await withoutJavaScript.getByRole("button", { name: /^Coordinator/ }).isDisabled());
    await withoutJavaScript.close();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const output = ".local/verification";
    await mkdir(output, { recursive: true });
    const health = await page.request.get(origin + "/api/health");
    assert.equal(health.status(), 200, "The served health route must be ready before the browser journey.");
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
    await verifyWorkspace(page, origin, output);
    const { cookies } = await page.context().storageState();
    const draftPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyMarkdownDraft(draftPage, origin, output);
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
    assert.equal((await other.request.get(origin + "/app/repos/1001/workspace")).status(), 404);
    const draftEndpoint = origin + draftRoute + "?" + new URLSearchParams({ path: draftPath });
    assert.equal((await other.request.get(draftEndpoint)).status(), 404);

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
    assert.equal((await reader.request.get(draftEndpoint)).status(), 403);
    assert.equal((await reader.request.patch(origin + draftRoute, { headers: { origin },
      data: { path: draftPath, markdown: "Unauthorized change", sourceRevision: "0".repeat(40), version: 0 },
    })).status(), 403);
    await reader.getByRole("link", { name: "Open workspace", exact: true }).click();
    const readerPane = reader.locator(".workspace-pane[data-focused='true']");
    await readerPane.locator("summary[aria-label='Pane actions']").click();
    await readerPane.getByRole("button", { name: "Source", exact: true }).click();
    const readerEditor = readerPane.getByRole("textbox", { name: "Markdown editor" });
    await readerEditor.waitFor();
    assert.equal(await readerEditor.getAttribute("contenteditable"), "false");
    assert.equal(await readerPane.getByRole("button", { name: "Edit draft", exact: true }).count(), 0);
  } finally {
    await stopVerificationBrowser(server);
  }
  console.log(`${browserType.name()} entry, fixture setup and signed publication, authorized workspace and private drafts, and browser shutdown passed.`);
}
