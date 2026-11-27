import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { Browser, BrowserServer, Locator, Page } from "playwright";

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
const proposalRoute = "/api/repos/1001/draft-proposal";

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
  const editable = editor.and(pane.locator('[contenteditable="true"]'));
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
  await editable.waitFor();
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
  await editable.waitFor();
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
  await editable.waitFor();
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

async function verifyMarkdownProposal(page: Page, origin: string, output: string) {
  const repo = origin + "/app/repos/1001";
  const endpoint = origin + proposalRoute;
  const pathname = "?" + new URLSearchParams({ path: draftPath });
  const documentUrl = origin + draftRoute + pathname;
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  type Proposal = {
    id: string; branch: string; provider: "fixture"; status: "open" | "merged";
    baseRevision: string; headRevision: string; mergeRevision: string | null;
  };
  type Snapshot = { status: string; revision: string; snapshot: { documents: { path: string; markdown: string }[] } };
  const snapshot = async () => {
    const response = await page.request.get(snapshotUrl);
    assert.equal(response.status(), 200);
    return await response.json() as Snapshot;
  };
  const waitForAction = () => page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && new URL(candidate.url()).pathname === proposalRoute);
  const post = (data: object, requestOrigin = origin) => page.request.post(endpoint, {
    headers: { origin: requestOrigin }, data,
  });
  const draftResponse = await page.request.get(documentUrl);
  assert.equal(draftResponse.status(), 200);
  type Draft = { markdown: string; version: number; sourceRevision: string };
  const { draft: invalidDraft } = await draftResponse.json() as { draft: Draft | null };
  assert.ok(invalidDraft, "A saved private draft is required for the proposal journey.");
  const publishedBefore = await snapshot();
  assert.equal(publishedBefore.status, "current");
  assert.notEqual(publishedBefore.snapshot.documents.find(({ path }) => path === draftPath)?.markdown, invalidDraft.markdown);

  const initial = await page.request.get(endpoint + pathname);
  assert.equal(initial.status(), 200);
  assert.equal(initial.headers()["cache-control"], "private, no-store");
  assert.equal((await initial.json()).proposal, null);
  const proposed = { action: "propose", path: draftPath, version: invalidDraft.version };
  assert.equal((await post(proposed, "https://untrusted.invalid")).status(), 403);
  assert.equal((await post({ ...proposed, version: invalidDraft.version - 1 })).status(), 409);

  await page.goto(repo + "/workspace");
  const pane = page.locator(".workspace-pane[data-focused='true']");
  await pane.getByRole("tab", { name: "CONTEXT.md", selected: true }).waitFor();
  const edit = pane.getByRole("button", { name: "Edit draft", exact: true });
  const propose = pane.getByRole("button", { name: "Propose change", exact: true });
  await edit.click();
  const [rejected] = await Promise.all([waitForAction(), propose.click()]);
  assert.equal(rejected.status(), 422);
  const invalid = await rejected.json() as { status: string; issues: { path: string; code: string }[] };
  assert.equal(invalid.status, "invalid_candidate");
  assert.ok(invalid.issues.some(({ path, code }) => path === draftPath && code === "note-headings"));
  await pane.getByRole("alert").filter({ hasText: "The proposed change did not pass validation." }).waitFor();
  assert.equal((await (await page.request.get(endpoint + pathname)).json()).proposal, null);
  assert.deepEqual((await snapshot()).snapshot.documents, publishedBefore.snapshot.documents);

  const correctedMarkdown = invalidDraft.markdown.replace("\n## Draft fixture\n", "\n### Draft fixture\n");
  assert.notEqual(correctedMarkdown, invalidDraft.markdown);
  const corrected = await page.request.patch(origin + draftRoute, { headers: { origin }, data: {
    path: draftPath, markdown: correctedMarkdown, version: invalidDraft.version, sourceRevision: invalidDraft.sourceRevision,
  } });
  assert.equal(corrected.status(), 200);
  const { draft } = await corrected.json() as { draft: Draft };
  await page.reload();
  await edit.click();
  const [created] = await Promise.all([waitForAction(), propose.click()]);
  assert.equal(created.status(), 200);
  const { proposal } = await created.json() as { proposal: Proposal };
  assert.ok(proposal.id && proposal.branch);
  assert.equal(proposal.provider, "fixture");
  assert.equal(proposal.status, "open");
  assert.equal(proposal.baseRevision, publishedBefore.revision);
  assert.notEqual(proposal.headRevision, publishedBefore.revision);
  const panel = pane.getByRole("group", { name: "Change proposal" });
  await panel.getByText("Simulated PR open", { exact: true }).waitFor();
  await page.screenshot({ path: output + "/markdown-proposal-desktop.png" });
  const repeated = await post({ ...proposed, version: draft.version });
  assert.equal(repeated.status(), 200);
  assert.deepEqual((await repeated.json()).proposal, proposal);
  const stillPublished = await snapshot();
  assert.equal(stillPublished.revision, publishedBefore.revision);
  assert.deepEqual(stillPublished.snapshot.documents, publishedBefore.snapshot.documents);

  const merge = { action: "merge", path: draftPath, proposalId: proposal.id, expectedHead: proposal.headRevision };
  assert.equal((await post({ ...merge, expectedHead: "0".repeat(40) })).status(), 409);
  const [merged] = await Promise.all([waitForAction(), panel.getByRole("button", { name: "Simulate change merge", exact: true }).click()]);
  assert.equal(merged.status(), 200);
  const { proposal: mergedProposal } = await merged.json() as { proposal: Proposal };
  assert.equal(mergedProposal.id, proposal.id);
  assert.equal(mergedProposal.status, "merged");
  assert.ok(mergedProposal.mergeRevision);
  assert.match(mergedProposal.mergeRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  const replay = await post(merge);
  assert.equal(replay.status(), 200);
  assert.deepEqual((await replay.json()).proposal, mergedProposal);
  await panel.getByText("Change indexed", { exact: true }).waitFor({ timeout: 35_000 });
  const publishedAfter = await snapshot();
  assert.equal(publishedAfter.status, "current");
  assert.equal(publishedAfter.revision, mergedProposal.mergeRevision);
  assert.deepEqual(publishedAfter.snapshot.documents, publishedBefore.snapshot.documents.map((file) =>
    file.path === draftPath ? { ...file, markdown: draft.markdown } : file));
  const afterMerge = await page.request.get(documentUrl);
  assert.equal(afterMerge.status(), 200);
  assert.deepEqual(await afterMerge.json(), {
    status: "ready", source: draft.markdown, sourceRevision: mergedProposal.mergeRevision, draft: null,
  });
  await page.reload();
  await pane.locator(".workspace-reading").getByText("Saved in another tab.", { exact: true }).waitFor();
  await page.goto(repo);
  await page.getByRole("heading", { name: "Repository indexed", exact: true }).waitFor();
  await page.getByText(mergedProposal.mergeRevision, { exact: true }).waitFor();
  await page.getByRole("link", { name: "Open workspace", exact: true }).waitFor();
  await page.close();
}

async function verifyWorkspaceGraphs(page: Page, origin: string, output: string) {
  await page.goto(origin + "/app/repos/1001/workspace");
  const controls = page.getByRole("navigation", { name: "Workspace controls" });
  await controls.getByRole("button", { name: "Memory Graph", exact: true }).click();
  const memory = page.getByRole("region", { name: "Memory Graph", exact: true });
  const memoryCanvas = memory.getByTestId("workspace-graph-canvas");
  const memoryEdge = memoryCanvas.getByTestId("workspace-graph-edge").first();
  await memoryEdge.waitFor({ state: "attached" });
  await memory.locator('[data-testid="workspace-graph-canvas"][data-layout="settled"]').waitFor();
  assert.deepEqual(await memoryEdge.evaluate((edge) => {
    const style = getComputedStyle(edge);
    return [style.stroke, style.strokeWidth, edge.getAttribute("vector-effect")];
  }), ["rgb(58, 58, 58)", "1px", "non-scaling-stroke"]);
  await page.screenshot({ path: output + "/workspace-memory-graph.png" });
  await memory.getByRole("button", { name: "List view", exact: true }).click();
  const notes = memory.getByRole("list", { name: "Graph nodes" });
  const indexNote = notes.getByRole("button", { name: "nutshell-vault/_INDEX.md", exact: true });
  await indexNote.waitFor();
  const findNote = memory.getByRole("searchbox", { name: "Search graph" });
  await findNote.fill("Retired capture log");
  await indexNote.waitFor({ state: "hidden" });
  assert.equal(await notes.getByRole("button").count(), 0);
  await findNote.fill("");
  await indexNote.press("Enter");
  const memoryDetail = memory.getByRole("complementary", { name: "Selected graph item" });
  await memoryDetail.getByRole("button", { name: "Open note", exact: true }).click();
  await page.getByRole("tab", { name: "_INDEX.md", selected: true }).waitFor();

  await page.keyboard.press("Control+P");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await palette.getByRole("combobox", { name: "Search commands and files" }).fill("Product Map");
  await palette.getByRole("option", { name: "Product Map", exact: true }).click();
  const product = page.getByRole("region", { name: "Product Map", exact: true });
  const canvas = product.getByTestId("workspace-graph-canvas");
  await canvas.getByTestId("workspace-graph-edge").first().waitFor({ state: "attached" });
  const capture = canvas.getByRole("button", { name: "Observation capture", exact: true });
  const unrelated = canvas.getByRole("button", { name: "Field Notes", exact: true });
  const store = canvas.getByRole("button", { name: "Observation store", exact: true });
  await capture.hover();
  await capture.and(canvas.locator('[data-highlighted="true"]')).waitFor();
  await unrelated.and(canvas.locator('[data-dimmed="true"]')).waitFor();
  assert.equal(await store.getAttribute("data-dimmed"), "false");
  await page.waitForFunction(() => {
    const unrelated = document.querySelector('.workspace-graph-node[aria-label="Field Notes"][data-dimmed="true"]');
    return unrelated && getComputedStyle(unrelated).opacity === "0.2";
  });
  const viewport = canvas.locator(".react-flow__viewport");
  const beforeZoom = await viewport.evaluate((node) => getComputedStyle(node).transform);
  await product.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForFunction((before) => {
    const viewport = document.querySelector('[data-testid="workspace-graph-canvas"] .react-flow__viewport');
    return viewport && getComputedStyle(viewport).transform !== before;
  }, beforeZoom);
  await product.getByRole("button", { name: "Fit graph", exact: true }).click();
  await product.getByRole("button", { name: "Pause layout", exact: true }).click();
  await product.locator('[data-testid="workspace-graph-canvas"][data-layout="paused"]').waitFor();
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  const beforeLayout = await (await page.request.get(snapshotUrl)).json();
  const canvasBounds = await canvas.locator(".react-flow__pane").boundingBox();
  assert.ok(canvasBounds);
  const beforePan = await viewport.evaluate((node) => getComputedStyle(node).transform);
  await page.mouse.move(canvasBounds.x + 12, canvasBounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + 64, canvasBounds.y + 46, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(await viewport.evaluate((node) => getComputedStyle(node).transform), beforePan);

  const nodeBounds = await capture.boundingBox();
  assert.ok(nodeBounds);
  const beforeDrag = await capture.evaluate((node) => node.closest<HTMLElement>(".react-flow__node")?.style.transform);
  const start = { x: nodeBounds.x + nodeBounds.width / 2, y: nodeBounds.y + nodeBounds.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 38, start.y + 24, { steps: 6 });
  await page.mouse.up();
  assert.notEqual(await capture.evaluate((node) => node.closest<HTMLElement>(".react-flow__node")?.style.transform), beforeDrag);
  const afterLayout = await (await page.request.get(snapshotUrl)).json();
  assert.equal(afterLayout.revision, beforeLayout.revision);
  assert.deepEqual(afterLayout.snapshot.entities, beforeLayout.snapshot.entities);

  await product.getByRole("button", { name: "Resume layout", exact: true }).click();
  await capture.press("Enter");
  const productDetail = product.getByRole("complementary", { name: "Selected graph item" });
  await productDetail.getByText(/depends on|depends_on/iu).first().waitFor();
  await productDetail.getByText("Observation store", { exact: false }).first().waitFor();
  await page.screenshot({ path: output + "/workspace-product-map.png" });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await product.locator('[data-testid="workspace-graph-canvas"][data-layout="reduced-motion"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('[data-testid="workspace-graph-canvas"]');
    if (!canvas) return false;
    const bounds = canvas.getBoundingClientRect();
    return ["Observation capture", "Observation store"].every((name) => {
      const node = canvas.querySelector(`[data-testid="workspace-graph-node"][aria-label="${name}"]`);
      if (!node) return false;
      const extent = node.getBoundingClientRect();
      return extent.width > 0 && extent.left >= bounds.left && extent.top >= bounds.top &&
        extent.right <= bounds.right && extent.bottom <= bounds.bottom;
    });
  });
  await page.screenshot({ path: output + "/workspace-product-map-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await product.getByRole("button", { name: "Focus neighborhood", exact: true }).click();
  await unrelated.waitFor({ state: "hidden" });
  await product.getByRole("button", { name: "Show full graph", exact: true }).click();
  await product.getByRole("button", { name: "List view", exact: true }).click();
  await product.getByRole("combobox", { name: "Graph kind" }).selectOption("service");
  const entities = product.getByRole("list", { name: "Graph nodes" });
  await entities.getByRole("button", { name: "Observation store", exact: true }).press("Enter");
  await productDetail.getByRole("button", { name: "Open entity", exact: true }).click();
  await page.getByRole("tab", { name: "Observation store", selected: true }).waitFor();
  await page.close();
}

async function verifyTeamTasks(page: Page, reader: Page, origin: string, output: string) {
  const taskPath = "/api/repos/1001/tasks";
  const endpoint = origin + taskPath;
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  type Task = { id: string; title: string; status: string; assigneeId: string; deadline: string | null; blocker: string | null; entityIds: string[]; version: number };
  async function openTasks(view: Page) {
    const controls = view.getByRole("navigation", { name: "Workspace controls" });
    await controls.getByRole("button", { name: "Team tasks", exact: true }).click();
    return view.getByRole("region", { name: "Team tasks", exact: true });
  }
  function waitForChange(view: Page, method: string, path: string) {
    return view.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === path);
  }

  const initial = await page.request.get(endpoint);
  assert.equal(initial.status(), 200);
  assert.equal(initial.headers()["cache-control"], "private, no-store");
  const scope = await initial.json() as { sourceRevision: string; viewerId: string; canManage: boolean };
  assert.equal(scope.viewerId, "local-coordinator");
  assert.equal(scope.canManage, true);
  const indexedBefore = await (await page.request.get(snapshotUrl)).json();
  assert.equal(scope.sourceRevision, indexedBefore.revision);
  await page.goto(origin + "/app/repos/1001/workspace");
  const tasks = await openTasks(page);
  const title = "Review field observations " + Date.now().toString(36);
  const deadline = "2032-02-29";
  await tasks.getByRole("button", { name: "New task", exact: true }).click();
  await tasks.getByLabel("Title", { exact: true }).fill(title);
  await tasks.getByLabel("Assignee", { exact: true }).selectOption("local-reader");
  await tasks.getByLabel("Deadline", { exact: true }).fill(deadline);
  await tasks.getByRole("checkbox", { name: "Observation capture", exact: true }).check();
  const save = tasks.getByRole("button", { name: "Save task", exact: true });
  const [created] = await Promise.all([waitForChange(page, "POST", taskPath), save.click()]);
  assert.equal(created.status(), 201);
  const { task } = await created.json() as { task: Task };
  assert.equal(task.title, title);
  assert.equal(task.assigneeId, "local-reader");
  assert.equal(task.deadline, deadline);
  assert.deepEqual(task.entityIds, ["feat_observation_capture"]);
  assert.equal(task.version, 1);
  const list = tasks.getByRole("list", { name: "Repository tasks" });
  await list.getByRole("button", { name: title, exact: true }).click();
  await tasks.getByRole("button", { name: "Edit task", exact: true }).click();
  const changedTitle = title + " again";
  await tasks.getByLabel("Title", { exact: true }).fill(changedTitle);

  const itemPath = `${taskPath}/${task.id}`;
  const itemEndpoint = origin + itemPath;
  const readerPatch = (changes: object) => reader.request.patch(itemEndpoint, { headers: { origin }, data: { version: task.version, changes } });
  assert.equal((await readerPatch({ title: "Unauthorized change" })).status(), 403);
  assert.equal((await readerPatch({ status: "blocked" })).status(), 400);
  const readerTasks = await openTasks(reader);
  const assigned = readerTasks.getByRole("list", { name: "Repository tasks" }).getByRole("button", { name: title, exact: true });
  await assigned.click();
  await readerTasks.getByRole("button", { name: "Edit task", exact: true }).click();
  await readerTasks.getByLabel("Status", { exact: true }).selectOption("blocked");
  const blocker = "Waiting for the updated field record.";
  await readerTasks.getByLabel("Blocker reason", { exact: true }).fill(blocker);
  const [assignedUpdate] = await Promise.all([waitForChange(reader, "PATCH", itemPath),
    readerTasks.getByRole("button", { name: "Save task", exact: true }).click()]);
  assert.equal(assignedUpdate.status(), 200);
  const { task: changedByReader } = await assignedUpdate.json() as { task: Task };
  assert.equal(changedByReader.blocker, blocker);
  const [stale] = await Promise.all([waitForChange(page, "PATCH", itemPath), save.click()]);
  assert.equal(stale.status(), 409);
  const collision = await stale.json() as { task: Task; attempted: { version: number } };
  assert.equal(collision.task.version, changedByReader.version);
  assert.equal(collision.attempted.version, task.version);
  assert.equal(await tasks.getByLabel("Title", { exact: true }).inputValue(), changedTitle);
  await tasks.getByRole("button", { name: `Keep edits with version ${changedByReader.version}`, exact: true }).click();
  assert.equal(await tasks.getByLabel("Title", { exact: true }).inputValue(), changedTitle);
  assert.equal(await tasks.getByLabel("Status", { exact: true }).inputValue(), "blocked");
  const [reconciled] = await Promise.all([waitForChange(page, "PATCH", itemPath), save.click()]);
  assert.equal(reconciled.status(), 200);
  const { task: finalTask } = await reconciled.json() as { task: Task };
  assert.deepEqual([finalTask.title, finalTask.blocker, finalTask.deadline, finalTask.status, finalTask.assigneeId],
    [changedTitle, blocker, deadline, "blocked", "local-reader"]);

  await page.reload();
  await tasks.getByRole("combobox", { name: "Task status", exact: true }).selectOption("blocked");
  await tasks.getByRole("combobox", { name: "Task assignee", exact: true }).selectOption("local-reader");
  await list.getByRole("button", { name: changedTitle, exact: true }).click();
  await tasks.getByText(deadline, { exact: true }).first().waitFor();
  await tasks.getByText(blocker, { exact: true }).first().waitFor();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (brief: string) => { document.documentElement.dataset.verificationTaskBrief = brief; },
    } });
  });
  await tasks.getByRole("button", { name: "Copy task brief", exact: true }).click();
  await tasks.getByRole("textbox", { name: "Task brief", exact: true }).waitFor();
  await page.waitForFunction(() => Boolean(document.documentElement.dataset.verificationTaskBrief));
  const brief = await page.locator("html").getAttribute("data-verification-task-brief");
  assert.ok(brief?.includes(scope.sourceRevision) && brief.includes("/app/repos/1001/workspace") && brief.includes(changedTitle));
  await page.screenshot({ path: output + "/workspace-team-tasks.png" });
  const indexedAfter = await (await page.request.get(snapshotUrl)).json();
  assert.equal(indexedAfter.revision, indexedBefore.revision);
  assert.deepEqual(indexedAfter.snapshot, indexedBefore.snapshot);
  const deleted = await page.request.delete(itemEndpoint, { headers: { origin }, data: { version: finalTask.version } });
  assert.equal(deleted.status(), 200);
  await page.close();
}

async function verifyTeamNotes(coordinator: Page, reader: Page, origin: string, output: string) {
  const path = "/api/repos/1001/notes";
  const endpoint = origin + path;
  const snapshot = origin + "/api/repos/1001/snapshot";
  type Note = { id: string; title: string; version: number; creatorId: string; content: { schemaVersion: number; doc: { content: unknown[] } } };
  async function openNotes(view: Page) {
    await view.goto(origin + "/app/repos/1001/workspace");
    await view.getByRole("navigation", { name: "Workspace controls" })
      .getByRole("button", { name: "Team notes", exact: true }).click();
    return view.getByRole("region", { name: "Team notes", exact: true });
  }
  async function saveNote(view: Page, region: Locator, method: string, target: string) {
    const [response] = await Promise.all([
      view.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === target),
      region.getByRole("button", { name: "Save note", exact: true }).click(),
    ]);
    return response;
  }

  const snapshotBefore = await (await coordinator.request.get(snapshot)).json();
  const readerNotes = await openNotes(reader);
  const title = "Field review " + Date.now().toString(36);
  await readerNotes.getByRole("button", { name: "New note", exact: true }).click();
  await readerNotes.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  const body = readerNotes.getByRole("textbox", { name: "Note body", exact: true });
  await body.fill("Field notes for the next review");
  const options = readerNotes.getByRole("button", { name: "Block options", exact: true });
  await options.press("Enter");
  await readerNotes.getByRole("menuitem", { name: "Paragraph", exact: true }).press("ArrowDown");
  await reader.keyboard.press("ArrowDown");
  const headingOption = readerNotes.getByRole("menuitem", { name: "Heading 2", exact: true });
  assert.equal(await headingOption.evaluate((option) => option === document.activeElement), true);
  await reader.keyboard.press("Enter");
  await body.getByRole("heading", { name: "Field notes for the next review", exact: true }).waitFor();
  await body.press("End");
  await body.press("Enter");
  await reader.keyboard.insertText("Check the observation date.");
  const created = await saveNote(reader, readerNotes, "POST", path);
  assert.equal(created.status(), 201);
  assert.equal(created.headers()["cache-control"], "private, no-store");
  const { note } = await created.json() as { note: Note };
  assert.deepEqual([note.creatorId, note.title, note.version, note.content.schemaVersion], ["local-reader", title, 1, 1]);
  assert.deepEqual(note.content.doc.content.map((node) => (node as { type: string }).type), ["heading", "paragraph"]);
  const listed = await reader.request.get(endpoint);
  assert.equal(listed.status(), 200);
  assert.equal(listed.headers()["cache-control"], "private, no-store");
  const visible = await listed.json() as { viewerId: string; canManage: boolean; notes: Note[] };
  assert.equal(visible.viewerId, "local-reader");
  assert.equal(visible.canManage, false);
  assert.deepEqual(visible.notes.find(({ id }) => id === note.id), note);
  const itemPath = path + "/" + note.id;
  const item = origin + itemPath;
  const sendInvalid = (block: object) => coordinator.request.patch(item, {
    headers: { origin }, data: { version: note.version, changes: { content: { schemaVersion: 1, doc: { type: "doc", content: [block] } } } },
  });
  assert.equal((await sendInvalid({ type: "image", attrs: { src: "https://example.com/hidden.png" } })).status(), 400);
  assert.equal((await sendInvalid({ type: "paragraph", content: [{
    type: "text", text: "Unsafe link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
  }] })).status(), 400);

  const coordinatorNotes = await openNotes(coordinator);
  await coordinatorNotes.getByRole("list", { name: "Repository notes" }).getByRole("button", { name: title, exact: true }).click();
  await coordinatorNotes.getByRole("heading", { name: "Field notes for the next review", exact: true }).waitFor();
  await coordinatorNotes.getByRole("button", { name: "Edit note", exact: true }).click();
  const coordinatorTitle = coordinatorNotes.getByRole("textbox", { name: "Title", exact: true });
  const coordinatorBody = coordinatorNotes.getByRole("textbox", { name: "Note body", exact: true });
  const revisedTitle = title + " confirmed";
  await coordinatorTitle.fill(revisedTitle);
  await readerNotes.getByRole("list", { name: "Repository notes" }).getByRole("button", { name: title, exact: true }).click();
  await readerNotes.getByRole("button", { name: "Edit note", exact: true }).click();
  await body.locator("p").last().click();
  await body.press("End");
  await reader.keyboard.insertText(" Signed off by the reader.");
  const updated = await saveNote(reader, readerNotes, "PATCH", itemPath);
  assert.equal(updated.status(), 200);
  const { note: readerUpdate } = await updated.json() as { note: Note };
  assert.match(JSON.stringify(readerUpdate.content), /Signed off by the reader/);

  const stale = await saveNote(coordinator, coordinatorNotes, "PATCH", itemPath);
  assert.equal(stale.status(), 409);
  const conflict = await stale.json() as { note: Note; attempted: { version: number; changes: { title: string } } };
  assert.deepEqual(conflict.note, readerUpdate);
  assert.equal(conflict.attempted.version, note.version);
  assert.equal(conflict.attempted.changes.title, revisedTitle);
  assert.equal(await coordinatorTitle.inputValue(), revisedTitle);
  assert.doesNotMatch((await coordinatorBody.textContent()) ?? "", /Signed off by the reader/);
  await coordinatorNotes.getByRole("button", { name: "Keep edits with version " + readerUpdate.version, exact: true }).click();
  assert.equal(await coordinatorTitle.inputValue(), revisedTitle);
  await coordinatorBody.getByText(/Signed off by the reader/).waitFor();
  await readerNotes.getByRole("button", { name: "Edit note", exact: true }).click();
  await body.locator("p").last().click();
  await body.press("End");
  const attemptedText = " Unsaved revision from a separate session.";
  await reader.keyboard.insertText(attemptedText);
  const reconciled = await saveNote(coordinator, coordinatorNotes, "PATCH", itemPath);
  assert.equal(reconciled.status(), 200);
  const { note: finalNote } = await reconciled.json() as { note: Note };
  assert.deepEqual(finalNote.content, readerUpdate.content);
  assert.equal(finalNote.title, revisedTitle);
  assert.equal(finalNote.version, 3);
  const staleBody = await saveNote(reader, readerNotes, "PATCH", itemPath);
  assert.equal(staleBody.status(), 409);
  const bodyConflict = await staleBody.json() as { note: Note; attempted: { version: number; changes: { content: Note["content"] } } };
  assert.equal(bodyConflict.attempted.version, readerUpdate.version);
  assert.ok(JSON.stringify(bodyConflict.attempted.changes.content).includes(attemptedText));
  assert.ok((await body.textContent())?.includes(attemptedText));
  assert.deepEqual(bodyConflict.note, finalNote);
  await readerNotes.getByRole("button", { name: "Discard edits and load saved version", exact: true }).click();
  const saved = readerNotes.getByRole("region", { name: "Selected note", exact: true });
  await saved.getByRole("heading", { name: revisedTitle, exact: true }).waitFor();
  const savedBody = saved.getByRole("document", { name: "Saved note body", exact: true });
  await savedBody.getByText(/Signed off by the reader/).waitFor();
  assert.ok(!(await savedBody.textContent())?.includes(attemptedText));
  await coordinator.reload();
  await coordinatorNotes.getByRole("list", { name: "Repository notes" }).getByRole("button", { name: revisedTitle, exact: true }).click();
  await coordinatorNotes.getByText(/Signed off by the reader/).waitFor();
  await coordinator.screenshot({ path: output + "/workspace-team-notes.png" });
  assert.deepEqual(await (await coordinator.request.get(snapshot)).json(), snapshotBefore);
  assert.equal((await coordinator.request.delete(item, { headers: { origin }, data: { version: finalNote.version } })).status(), 200);
  await coordinator.close();
}

async function verifyScreenshotEvidence(coordinator: Page, reader: Page, other: Page, origin: string, output: string) {
  const workspace = origin + "/app/repos/1001/workspace";
  const endpoint = origin + "/api/repos/1001/screenshots";
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  type Asset = { id: string; mimeType: string; sha256: string; byteLength: number; provenance: string; captureRef: string | null };
  const before = await coordinator.request.get(snapshotUrl);
  assert.equal(before.status(), 200);
  const { revision: sourceRevision } = await before.json() as { revision: string };
  assert.match(sourceRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  await coordinator.goto(workspace);
  const uploader = coordinator.getByRole("region", { name: "Screenshot evidence", exact: true });
  const input = uploader.getByLabel("Screenshot file", { exact: true });
  await input.waitFor();
  const screenshot = await coordinator.screenshot({ path: output + "/private-evidence-fixture.png", scale: "css" });
  const capturedAt = new Date().toISOString();
  await input.setInputFiles({ name: "field-notes.png", mimeType: "image/png", buffer: screenshot });
  const [uploaded] = await Promise.all([
    coordinator.waitForResponse((response) => response.url() === endpoint && response.request().method() === "POST"),
    uploader.getByRole("button", { name: "Upload screenshot", exact: true }).click(),
  ]);
  assert.equal(uploaded.status(), 201);
  const { asset } = await uploaded.json() as { asset: Asset };
  assert.deepEqual([asset.mimeType, asset.provenance, asset.captureRef], ["image/png", "declared", null]);
  assert.equal(await uploader.getByRole("textbox", { name: "Evidence asset ID", exact: true }).inputValue(), asset.id);

  const item = endpoint + "/" + encodeURIComponent(asset.id);
  const imageUrl = item + "/image";
  const image = await reader.request.get(imageUrl);
  assert.equal(image.status(), 200);
  assert.equal(image.headers()["content-type"], "image/png");
  assert.equal(image.headers()["cache-control"], "private, no-store");
  assert.equal(image.headers()["x-content-type-options"], "nosniff");
  const stored = await image.body();
  assert.equal(stored.byteLength, asset.byteLength);
  assert.equal(createHash("sha256").update(stored).digest("hex"), asset.sha256);
  assert.equal((await other.request.get(item)).status(), 404);
  assert.equal((await other.request.get(imageUrl)).status(), 404);
  const headers = { origin, "content-type": "image/png" };
  assert.equal((await reader.request.post(endpoint, { headers, data: screenshot })).status(), 403);
  assert.equal((await coordinator.request.post(endpoint, { headers, data: Buffer.from("not a PNG") })).status(), 400);
  assert.equal((await coordinator.request.post(endpoint, { headers, data: Buffer.alloc(8 * 1024 * 1024 + 1) })).status(), 413);
  assert.equal((await coordinator.request.post(endpoint, {
    headers: { origin, "content-type": "image/svg+xml" }, data: Buffer.from("<svg/>"),
  })).status(), 415);
  assert.equal((await coordinator.request.post(endpoint, {
    headers: { ...headers, "x-nutshell-screenshot": encodeURIComponent(JSON.stringify({ provenance: "fixture_capture" })) },
    data: screenshot,
  })).status(), 400);

  const { stdout } = await promisify(execFile)(process.execPath, [
    "scripts/fixture-screenshot-evidence.ts", sourceRevision, asset.id, capturedAt,
  ], { timeout: 90_000, env: { ...process.env, NUTSHELL_VERIFY: "1", NUTSHELL_ORIGIN: origin } });
  const evidenceRevision = stdout.trim();
  assert.match(evidenceRevision, /^[a-f0-9]{40}$/u);
  const deadline = Date.now() + 50_000;
  let indexed = false;
  while (!indexed && Date.now() < deadline) {
    const result = await coordinator.request.get(snapshotUrl, { timeout: 15_000 });
    assert.equal(result.status(), 200);
    const payload = await result.json() as { status: string; revision: string };
    indexed = payload.status === "current" && payload.revision === evidenceRevision;
    if (!indexed) await delay(250);
  }
  assert.equal(indexed, true, "Signed screenshot fixture must reach the indexed workspace.");

  await coordinator.reload();
  const explorer = coordinator.getByRole("navigation", { name: "Repository explorer", exact: true });
  const records = explorer.locator("summary").filter({ hasText: /^Product records$/u });
  if (!await records.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)) await records.click();
  await explorer.getByRole("button", { name: "Observation capture", exact: true }).click();
  const evidence = coordinator.getByRole("region", { name: "Evidence for Inspect screenshot evidence for observation capture.", exact: true });
  const declared = evidence.getByRole("listitem").filter({ hasText: asset.id });
  await declared.getByText("Declared screenshot", { exact: true }).waitFor();
  await evidence.getByText("Fixture capture", { exact: true }).waitFor();
  await evidence.getByText("Evidence unavailable", { exact: true }).waitFor();
  for (const alt of ["Screenshot for Uploaded workspace image", "Screenshot for workspace-indexed"]) {
    const element = evidence.getByRole("img", { name: alt, exact: true });
    await element.waitFor();
    assert.equal(await element.evaluate(async (node) => {
      if (!(node instanceof HTMLImageElement)) return 0;
      await node.decode();
      return node.naturalWidth;
    }), 1440);
  }
  assert.equal(await evidence.getByRole("img").count(), 2);
  await evidence.scrollIntoViewIfNeeded();
  await coordinator.screenshot({ path: output + "/workspace-screenshot-evidence.png" });
  await coordinator.close();
}

export async function verifyEntryFlow(origin: string) {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".local/playwright-preflight/browsers")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".local/playwright-preflight/browsers");
  }
  const { chromium, firefox } = await import("playwright");
  const browserType = process.platform === "win32" ? firefox : chromium;
  const server = await browserType.launchServer({ headless: true, host: "127.0.0.1", timeout: 30_000 });
  let journeyFailure: { error: unknown } | null = null;
  let client: Browser | null = null;
  try {
    const browser = await browserType.connect(server.wsEndpoint(), { timeout: 10_000 });
    client = browser;
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
    const denied = await page.goto(origin + "/app/repos/1002");
    assert.equal(denied?.status(), 404);
    assert.equal(await page.getByText("Harbor Atlas").count(), 0);
    await page.close();
    const draftPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyMarkdownDraft(draftPage, origin, output);

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
    const proposalEndpoint = origin + proposalRoute + "?" + new URLSearchParams({ path: draftPath });
    assert.equal((await other.request.get(proposalEndpoint)).status(), 404);
    assert.equal((await other.request.get(origin + "/api/repos/1001/tasks")).status(), 404);
    assert.equal((await other.request.get(origin + "/api/repos/1001/notes")).status(), 404);

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
    assert.equal((await reader.request.get(proposalEndpoint)).status(), 403);
    assert.equal((await reader.request.post(origin + proposalRoute, { headers: { origin },
      data: { action: "propose", path: draftPath, version: 1 },
    })).status(), 403);
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
    const teamTaskPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyTeamTasks(teamTaskPage, reader, origin, output);
    const teamNotePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyTeamNotes(teamNotePage, reader, origin, output);
    const proposalPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyMarkdownProposal(proposalPage, origin, output);
    const graphPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyWorkspaceGraphs(graphPage, origin, output);
    const evidencePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyScreenshotEvidence(evidencePage, reader, other, origin, output);
    await reader.close();
    await other.close();
  } catch (error) {
    journeyFailure = { error };
  }
  if (client) {
    const fixtures = client.contexts().flatMap((context) => context.pages());
    const closed = Promise.allSettled(fixtures.map((page) => page.close({ runBeforeUnload: false }))).then(() => true);
    await waitForBrowserClose(closed, 8_000);
    const disconnected = await waitForBrowserClose(client.close().then(() => true, () => false), 10_000);
    if (!disconnected && !journeyFailure) {
      journeyFailure = { error: new Error("The verification browser client did not disconnect in time.") };
    }
  }
  try {
    await stopVerificationBrowser(server);
  } catch (shutdownError) {
    if (!journeyFailure) throw shutdownError;
    const describe = (error: unknown) => error instanceof Error ? error.stack ?? error.message : String(error);
    throw new AggregateError([journeyFailure.error, shutdownError],
      `${describe(journeyFailure.error)}\n${describe(shutdownError)}`, { cause: shutdownError });
  }
  if (journeyFailure) throw journeyFailure.error;
  console.log(`${browserType.name()} entry, signed fixture setup, workspace, repository tasks and notes, private drafts, simulated proposal publication, both graph modes, private screenshot evidence, and browser shutdown passed.`);
}
