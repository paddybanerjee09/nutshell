import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { Browser, BrowserServer, Locator, Page, Request } from "playwright";

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
  const focusedPane = page.locator(".workspace-pane[data-focused='true']");
  const explorer = page.getByRole("navigation", { name: "Repository explorer" });
  const mac = process.platform === "darwin";
  const documentEnd = mac ? "Meta+ArrowDown" : "Control+End";

  function selectedNote(pane: Locator) {
    return pane.getByRole("tab", { name: "CONTEXT.md", exact: true, selected: true });
  }

  async function draftStep<T>(stage: string, perform: () => Promise<T>): Promise<T> {
    try {
      return await perform();
    } catch (error) {
      const panes = await page.locator(".workspace-pane").evaluateAll((nodes, path) => nodes.map((node) => ({
        id: node.getAttribute("data-pane-id"), focused: node.getAttribute("data-focused"),
        expectedNote: node.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title") === path,
        mode: node.querySelector(".workspace-markdown-editor")?.getAttribute("data-mode"),
        editable: node.querySelector(".cm-content")?.getAttribute("contenteditable"),
        editorFocused: node.contains(document.activeElement) && document.activeElement?.matches(".cm-content"),
      })), draftPath).catch(() => []);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Markdown draft ${stage} failed. Panes: ${JSON.stringify(panes)}\n${message}`, { cause: error });
    }
  }

  async function bindDraftPane(stage: string, afterPane?: string) {
    return draftStep(stage, async () => {
      if (afterPane) {
        await page.waitForFunction((originalPane) => {
          const rendered = Array.from(document.querySelectorAll(".workspace-pane"));
          return rendered.length === 2 && rendered.some((node) => node.getAttribute("data-focused") === "true"
            && node.getAttribute("data-pane-id") !== originalPane);
        }, afterPane);
      }
      await selectedNote(focusedPane).waitFor();
      const id = await focusedPane.getAttribute("data-pane-id");
      assert.ok(id);
      assert.notEqual(id, afterPane);
      const pane = page.locator(`.workspace-pane[data-pane-id=${JSON.stringify(id)}]`);
      assert.equal(await selectedNote(pane).getAttribute("title"), draftPath);
      const editor = pane.getByRole("textbox", { name: "Markdown editor", exact: true });
      const editable = editor.and(pane.locator('[contenteditable="true"]'));
      const pastedText = editor.locator(".cm-md-heading").filter({ hasText: /^Draft fixture$/u });
      return { id, pane, editable, pastedText };
    });
  }

  async function pressDraftKey(view: Awaited<ReturnType<typeof bindDraftPane>>, stage: string, key: string) {
    return draftStep(stage, async () => {
      assert.equal(await selectedNote(view.pane).getAttribute("title"), draftPath);
      await view.editable.press(key);
      await page.waitForFunction((paneId) => {
        const editor = document.activeElement;
        const pane = editor?.closest(".workspace-pane");
        return editor?.matches('.cm-content[contenteditable="true"]') && pane?.getAttribute("data-focused") === "true"
          && pane.getAttribute("data-pane-id") === paneId;
      }, view.id);
    });
  }

  async function openDocument() {
    for (const name of [/^features$/u, /^nutshell-setup$/u]) {
      const folder = explorer.locator("summary").filter({ hasText: name });
      if (!await folder.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)) await folder.click();
    }
    await explorer.getByRole("button", { name: draftPath, exact: true }).click();
  }
  async function paneAction(pane: Locator, name: string) {
    await pane.locator("summary[aria-label='Pane actions']").click();
    await pane.getByRole("button", { name, exact: true }).click();
  }

  await openDocument();
  const first = await bindDraftPane("opening the first document pane");
  await first.pane.getByRole("button", { name: "Edit draft", exact: true }).click();
  await first.pane.getByText("Private draft", { exact: true }).waitFor();
  await pressDraftKey(first, "moving to the end before paste", documentEnd);
  const addition = "\n\n## Draft fixture\n\n**認識** e\u0301 🌰 [[_INDEX|Index]]\n\n```txt\n[[literal]]\n```\n";
  const paste = () => first.editable.evaluate((element, text) => {
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    // Firefox drops the DataTransfer contents on a synthetic ClipboardEvent.
    Object.defineProperty(event, "clipboardData", { value: {
      getData: (format: string) => format === "text/plain" ? text : "",
    } });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, addition);
  assert.equal(await paste(), true);
  await pressDraftKey(first, "moving away from the pasted heading", documentEnd);
  await first.pastedText.waitFor();
  await pressDraftKey(first, "undoing the paste", mac ? "Meta+z" : "Control+z");
  await first.pastedText.waitFor({ state: "hidden" });
  await pressDraftKey(first, "redoing the paste", mac ? "Meta+Shift+z" : "Control+y");
  await first.pastedText.waitFor();
  await first.pastedText.click();
  await first.pane.getByText("## Draft fixture", { exact: true }).waitFor();
  await pressDraftKey(first, "moving the caret off the revealed heading", documentEnd);
  await first.pastedText.waitFor();

  await paneAction(first.pane, "Source");
  await first.pane.getByText("## Draft fixture", { exact: true }).waitFor();
  await paneAction(first.pane, "Live preview");
  await first.pastedText.waitFor();
  await paneAction(first.pane, "Split right");
  const second = await bindDraftPane("focusing the split with the same selected document", first.id);
  await second.pane.getByRole("button", { name: "Edit draft", exact: true }).click();
  await second.pane.getByText("Private draft", { exact: true }).waitFor();
  await pressDraftKey(second, "focusing the shared draft in the new split", documentEnd);
  await Promise.all([first.pastedText.waitFor(), second.pastedText.waitFor()]);
  assert.ok(await second.pane.getByRole("group", { name: "Document view" }).evaluate((bar) => {
    const panel = bar.closest("[role='tabpanel']");
    return panel && bar.getBoundingClientRect().top >= panel.getBoundingClientRect().top;
  }), "The draft status and save control must stay visible when the editor scrolls.");
  await page.screenshot({ path: output + "/markdown-draft-desktop.png" });

  const waitForSave = () => page.waitForResponse((candidate) =>
    candidate.request().method() === "PATCH" && new URL(candidate.url()).pathname === draftRoute);
  const [saved] = await Promise.all([waitForSave(), second.pane.getByRole("button", { name: "Save draft", exact: true }).click()]);
  assert.equal(saved.status(), 200);
  const savedDraft = (await saved.json()).draft;
  assert.equal(savedDraft.version, version + 1);
  assert.equal(savedDraft.markdown, base + addition);
  const current = async () => (await (await page.request.get(documentUrl)).json());
  assert.equal((await current()).source, source);
  await second.pane.getByText("Draft saved", { exact: true }).waitFor();

  await page.reload();
  await openDocument();
  const reopened = await bindDraftPane("reopening the saved document after reload");
  await reopened.pane.getByRole("button", { name: "Edit draft", exact: true }).click();
  await reopened.pane.getByText("Private draft", { exact: true }).waitFor();
  await pressDraftKey(reopened, "focusing the persisted draft", documentEnd);
  await reopened.pastedText.waitFor();
  const parallel = { path: draftPath, markdown: savedDraft.markdown + "\nSaved in another tab.\n", sourceRevision, version: savedDraft.version };
  assert.equal((await page.request.patch(endpoint, { headers: { origin: "https://untrusted.invalid" }, data: parallel })).status(), 403);
  assert.equal((await page.request.patch(endpoint, { headers: { origin }, data: parallel })).status(), 200);
  await pressDraftKey(reopened, "focusing the draft before a conflicting local edit", documentEnd);
  await page.keyboard.insertText("Unsaved local text.");
  const [conflict] = await Promise.all([waitForSave(), reopened.pane.getByRole("button", { name: "Save draft", exact: true }).click()]);
  assert.equal(conflict.status(), 409);
  assert.equal((await conflict.json()).reason, "version");
  await reopened.pane.getByRole("alert").waitFor();
  await reopened.pane.getByText("Unsaved local text.", { exact: true }).waitFor();
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

async function verifyNewMarkdownNote(page: Page, reader: Page, other: Page, origin: string, output: string) {
  const indexPath = "nutshell-vault/_INDEX.md";
  const endpoint = origin + "/api/repos/1001/draft";
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  type NoteSnapshot = { revision: string; snapshot: { documents: { path: string; markdown: string }[] } };
  async function snapshot() {
    const response = await page.request.get(snapshotUrl);
    assert.equal(response.status(), 200);
    return await response.json() as NoteSnapshot;
  }

  const before = await snapshot();
  const relativePath = `notes/verification-${before.revision.slice(0, 8)}/Rainfall review.md`;
  const path = "nutshell-vault/" + relativePath;
  assert.ok(!before.snapshot.documents.some((note) => note.path === path));
  await page.goto(origin + "/app/repos/1001/workspace");
  await page.locator("main.workspace-shell[aria-busy='false']").waitFor();
  await page.keyboard.press("Control+P");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search commands and files" });
  await search.fill("New Markdown note");
  await palette.getByRole("option", { name: "New Markdown note", exact: true, selected: true }).waitFor();
  await search.press("Enter");
  const form = page.getByRole("form", { name: "New Markdown note" });
  await form.getByLabel("Title", { exact: true }).fill("Rainfall review");
  await form.getByLabel("Vault path", { exact: true }).fill(relativePath);
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.url() === endpoint && response.request().method() === "POST"),
    form.getByRole("button", { name: "Create private draft", exact: true }).press("Enter"),
  ]);
  assert.equal(created.status(), 200);
  const { draft } = await created.json() as { draft: { path: string; markdown: string; version: number; sourceBlob: string | null } };
  assert.deepEqual([draft.path, draft.version, draft.sourceBlob], [path, 1, null]);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await reader.request.get(endpoint)).status(), 403);
  assert.equal((await other.request.get(endpoint)).status(), 404);

  await page.reload();
  await page.getByRole("tab", { name: "Rainfall review.md", exact: true, selected: true }).waitFor();
  const pane = page.locator(".workspace-pane[data-focused='true']");
  await pane.getByText("Private draft", { exact: true }).waitFor();
  await pane.locator("summary[aria-label='Pane actions']").click();
  await pane.getByRole("button", { name: "Source", exact: true }).click();
  const editor = pane.getByRole("textbox", { name: "Markdown editor" });
  await editor.getByText("# Rainfall review", { exact: true }).waitFor();
  const addition = "\nRainfall measurements remain linked to their original observation.\n";
  await editor.press("Control+End");
  await page.keyboard.insertText(addition);
  await pane.getByRole("button", { name: "Save draft", exact: true }).click();
  await pane.getByText("Version 2", { exact: true }).waitFor();
  const draftRead = await page.request.get(endpoint + "?path=" + encodeURIComponent(path));
  assert.equal(draftRead.status(), 200);
  const saved = await draftRead.json() as { draft: { markdown: string }; source: string };
  assert.equal(saved.source, "");
  assert.equal(saved.draft.markdown, draft.markdown + addition);
  await pane.getByRole("button", { name: "Propose change", exact: true }).click();
  await pane.getByText("Simulated PR open", { exact: true }).waitFor();
  assert.deepEqual(await snapshot(), before);
  await pane.getByRole("button", { name: "Simulate change merge", exact: true }).click();
  await pane.getByText("Change indexed", { exact: true }).waitFor({ timeout: 60_000 });
  const after = await snapshot();
  assert.notEqual(after.revision, before.revision);
  const beforeDocs = new Map(before.snapshot.documents.map((note) => [note.path, note.markdown]));
  const afterDocs = new Map(after.snapshot.documents.map((note) => [note.path, note.markdown]));
  assert.equal(afterDocs.size, beforeDocs.size + 1);
  assert.equal(afterDocs.get(path), saved.draft.markdown);
  const index = afterDocs.get(indexPath);
  const target = relativePath.split("/").map(encodeURIComponent).join("/");
  const rows = index?.match(/[^\n]*\n|[^\n]+$/gu)?.filter((line) => line.startsWith(`| [${path}](<${target}>)`));
  const row = rows?.[0];
  assert.ok(index && row && rows?.length === 1);
  assert.equal(index.replace(row, ""), beforeDocs.get(indexPath));
  for (const [oldPath, markdown] of beforeDocs) if (oldPath !== indexPath) assert.equal(afterDocs.get(oldPath), markdown);
  const published = await page.request.get(endpoint + "?path=" + encodeURIComponent(path));
  assert.equal(published.status(), 200);
  assert.deepEqual(await published.json(), { status: "ready", source: saved.draft.markdown, sourceRevision: after.revision, draft: null });
  await pane.locator("summary[aria-label='Pane actions']").click();
  await pane.getByRole("button", { name: "Read", exact: true }).click();
  await pane.getByText("Canonical", { exact: true }).waitFor();
  await pane.getByRole("heading", { name: "Rainfall review", exact: true }).waitFor();
  await page.screenshot({ path: output + "/workspace-new-markdown-note.png" });
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
  await page.getByRole("tab", { name: "Product Map", selected: true, exact: true }).waitFor();
  const product = page.getByRole("region", { name: "Product Map", exact: true });
  await product.getByRole("group", { name: "Visible graph scope" }).getByText(/1 of 1 declared relationships/u).waitFor();
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
  const mobileGraph = {
    canvasSelector: '.workspace-pane[data-focused="true"] .workspace-graph-panel [data-testid="workspace-graph-canvas"]',
    nodes: ["Observation capture", "Observation store"],
  };
  try {
    await page.waitForFunction(({ canvasSelector, nodes }) => {
      const canvas = document.querySelector('.workspace-main[data-compact="true"]')?.querySelector(canvasSelector);
      const pane = canvas?.querySelector(".react-flow__pane");
      if (!canvas || !pane || canvas.getAttribute("data-layout") !== "reduced-motion") return false;
      const labelId = canvas.closest(".workspace-graph-panel")?.getAttribute("aria-labelledby");
      if (!labelId || document.getElementById(labelId)?.textContent !== "Product Map") return false;
      const paneBounds = pane.getBoundingClientRect();
      if (paneBounds.width <= 0 || paneBounds.height <= 0) return false;
      const bounds = canvas.getBoundingClientRect();
      return nodes.every((name) => {
        const node = canvas.querySelector(`[data-testid="workspace-graph-node"][aria-label="${name}"]`);
        if (!node) return false;
        const extent = node.getBoundingClientRect();
        return extent.width > 0 && extent.left >= bounds.left && extent.top >= bounds.top &&
          extent.right <= bounds.right && extent.bottom <= bounds.bottom;
      });
    }, mobileGraph);
  } catch (error) {
    const geometry = await page.evaluate(({ canvasSelector, nodes }) => {
      const canvas = document.querySelector(canvasSelector);
      const viewport = canvas?.querySelector(".react-flow__viewport");
      const labelId = canvas?.closest(".workspace-graph-panel")?.getAttribute("aria-labelledby");
      const bounds = (element: Element | null | undefined) => element?.getBoundingClientRect().toJSON() ?? null;
      return {
        screen: { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
        compact: document.querySelector(".workspace-main")?.getAttribute("data-compact"),
        title: labelId ? document.getElementById(labelId)?.textContent : null,
        layout: canvas?.getAttribute("data-layout"),
        canvas: bounds(canvas),
        pane: bounds(canvas?.querySelector(".react-flow__pane")),
        transform: viewport ? getComputedStyle(viewport).transform : null,
        nodes: nodes.map((name) => ({ name, bounds: bounds(canvas?.querySelector(`[data-testid="workspace-graph-node"][aria-label="${name}"]`)) })),
      };
    }, mobileGraph).catch(() => null);
    await page.screenshot({ path: output + "/workspace-product-map-mobile-failure.png", timeout: 3_000 }).catch(() => {});
    throw new Error(`The mobile Product Map did not fit its nodes. Geometry ${JSON.stringify(geometry)}`, { cause: error });
  }
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
  coordinator.setDefaultTimeout(30_000);
  const workspace = origin + "/app/repos/1001/workspace";
  const endpoint = origin + "/api/repos/1001/screenshots";
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  type Asset = { id: string; mimeType: string; sha256: string; byteLength: number; provenance: string; captureRef: string | null };
  const before = await coordinator.request.get(snapshotUrl);
  assert.equal(before.status(), 200);
  const { revision: sourceRevision } = await before.json() as { revision: string };
  assert.match(sourceRevision, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
  const readyWorkspace = coordinator.locator("main.workspace-shell[aria-busy='false']");
  await coordinator.goto(workspace);
  await readyWorkspace.waitFor();
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
    const payload = await result.json() as {
      status: string;
      revision: string;
      snapshot: { changes: Array<{ id: string; evidence: Array<{ asset_id: string }> }> } | null;
    };
    indexed = payload.status === "current" && payload.revision === evidenceRevision;
    if (indexed) {
      const change = payload.snapshot?.changes.find(({ id }) => id === "chg_private_screenshot_fixture");
      assert.ok(change?.evidence.some(({ asset_id }) => asset_id === asset.id), "The indexed change must reference the exact uploaded asset.");
    } else await delay(250);
  }
  assert.equal(indexed, true, "Signed screenshot fixture must reach the indexed workspace.");
  console.log("Indexed the signed screenshot evidence and verified its exact asset reference.");

  const served = await coordinator.request.get(workspace, { timeout: 15_000, maxRedirects: 0 });
  assert.equal(served.status(), 200);
  const isInitiallyInert = await coordinator.evaluate((html) => new DOMParser().parseFromString(html, "text/html")
    .querySelector("main.workspace-shell[aria-busy='true'] .workspace-main[inert]") !== null, await served.text());
  assert.equal(isInitiallyInert, true, "The server-rendered workspace must be busy and inert before hydration.");
  console.log("Verified the initial workspace markup before hydration.");
  await coordinator.reload();
  await readyWorkspace.waitFor();
  await readyWorkspace.getByTestId("workspace-status").locator(`.workspace-status-state[title="${evidenceRevision}"]`)
    .filter({ hasText: /^Indexed$/u }).waitFor();
  const explorer = readyWorkspace.getByRole("navigation", { name: "Repository explorer", exact: true });
  const records = explorer.locator("summary").filter({ hasText: /^Product records$/u });
  if (!await records.evaluate((node) => (node.parentElement as HTMLDetailsElement).open)) await records.click();
  const observation = explorer.getByRole("button", { name: "Observation capture", exact: true });
  await observation.click();
  await observation.and(explorer.locator('[aria-current="true"]')).waitFor();
  const details = readyWorkspace.getByRole("region", { name: "Details", exact: true });
  if (!await details.isVisible()) {
    await readyWorkspace.getByRole("navigation", { name: "Workspace controls", exact: true })
      .getByRole("button", { name: "Details", exact: true }).click();
  }
  await details.waitFor();
  const evidence = details.getByRole("region", { name: "Evidence for Inspect screenshot evidence for observation capture.", exact: true });
  await evidence.waitFor();
  const declared = evidence.getByRole("listitem").filter({ has: coordinator.getByText(asset.id, { exact: true }) });
  await declared.waitFor();
  await declared.getByText("Declared screenshot", { exact: true }).waitFor();
  await evidence.getByText("Fixture capture", { exact: true }).waitFor();
  await evidence.getByText("Evidence unavailable", { exact: true }).waitFor();
  for (const alt of ["Screenshot for Uploaded workspace image", "Screenshot for workspace-indexed"]) {
    const element = evidence.getByRole("img", { name: alt, exact: true });
    await element.waitFor();
    assert.equal(await element.evaluate((node) => node instanceof HTMLImageElement && node.complete ? node.naturalWidth : 0), 1440);
  }
  assert.equal(await evidence.getByRole("img").count(), 2);
  await evidence.scrollIntoViewIfNeeded();
  await coordinator.screenshot({ path: output + "/workspace-screenshot-evidence.png" });
  await coordinator.close();
}

async function verifyProductHistory(coordinator: Page, reader: Page, other: Page, origin: string, output: string) {
  const workspace = origin + "/app/repos/1001/workspace";
  const snapshotUrl = origin + "/api/repos/1001/snapshot";
  const historyUrl = origin + "/api/repos/1001/history";
  const before = await coordinator.request.get(snapshotUrl);
  assert.equal(before.status(), 200);
  const { revision: sourceRevision } = await before.json() as { revision: string };
  const { stdout } = await promisify(execFile)(process.execPath, [
    "scripts/fixture-product-history.ts", sourceRevision,
  ], {
    // The child performs six independently bounded publications.
    timeout: 420_000, env: { ...process.env, NUTSHELL_VERIFY: "1", NUTSHELL_ORIGIN: origin },
  });
  const proof = JSON.parse(stdout) as {
    originalRevision: string; correctedRevision: string; reversedRevision: string;
    latestValid: string; rejectedRevision: string; notePath: string; originalText: string;
  };
  const snapshot = await reader.request.get(snapshotUrl);
  assert.equal(snapshot.status(), 200);
  const indexed = await snapshot.json() as { status: string; revision: string; headRevision: string };
  assert.deepEqual([indexed.status, indexed.revision, indexed.headRevision], ["invalid", proof.latestValid, proof.rejectedRevision]);
  const historyResponse = await reader.request.get(historyUrl);
  assert.equal(historyResponse.status(), 200);
  assert.equal(historyResponse.headers()["cache-control"], "private, no-store");
  type Entry = { id: string; sourceRevision: string; change: { summary: string }; entities: { id: string; title: string }[] };
  const read = await historyResponse.json() as { revision: string; status: string; entries: Entry[] };
  assert.deepEqual([read.status, read.revision], ["invalid", proof.latestValid]);
  const entries = read.entries.filter(({ id }) => id.startsWith("chg_observation_history_"));
  assert.equal(entries.length, 3);
  const revisions = new Map(entries.map(({ id, sourceRevision }) => [id, sourceRevision]));
  assert.deepEqual(revisions, new Map([
    ["chg_observation_history_start", proof.originalRevision],
    ["chg_observation_history_correct", proof.correctedRevision],
    ["chg_observation_history_reverse", proof.reversedRevision],
  ]));
  const original = entries.find(({ id }) => id === "chg_observation_history_start");
  assert.equal(original?.change.summary, "Start observation history");
  assert.equal(original?.entities.find(({ id }) => id === "feat_observation_capture")?.title, "Observation capture");
  const originalUrl = historyUrl + "/chg_observation_history_start?" + new URLSearchParams({ path: proof.notePath });
  const oldNote = await reader.request.get(originalUrl);
  assert.equal(oldNote.status(), 200);
  const originalContent = await oldNote.json() as { sourceRevision: string; markdown: string; path: string };
  assert.equal(originalContent.sourceRevision, proof.originalRevision);
  assert.equal(originalContent.path, proof.notePath);
  assert.ok(originalContent.markdown.includes(proof.originalText));
  assert.equal((await other.request.get(historyUrl)).status(), 404);
  assert.equal((await other.request.get(originalUrl)).status(), 404);

  await coordinator.goto(workspace);
  await coordinator.getByRole("navigation", { name: "Workspace controls" }).getByRole("button", { name: "History", exact: true }).click();
  const history = coordinator.getByRole("region", { name: "Product history", exact: true });
  await history.getByText(/last valid|source.*invalid/i).first().waitFor();
  await history.getByRole("combobox", { name: "Group history by", exact: true }).selectOption("kind");
  await history.getByRole("combobox", { name: "History entity", exact: true }).selectOption("feat_observation_capture");
  const events = history.getByRole("navigation", { name: "History events", exact: true });
  await events.getByRole("button", { name: "Retire the observation workflow", exact: true }).click();
  const selected = history.getByRole("region", { name: "Selected change", exact: true });
  await selected.getByText("Fixture observation", { exact: true }).waitFor();
  await selected.getByText("Deployment unknown", { exact: true }).waitFor();
  await selected.getByRole("button", { name: "Reverses Clarify the observation workflow", exact: true }).click();
  await selected.getByRole("button", { name: "Corrects Start observation history", exact: true }).click();
  await selected.getByText(proof.originalRevision, { exact: true }).first().waitFor();
  await selected.getByRole("button", { name: proof.notePath, exact: true }).click();
  const note = history.getByRole("region", { name: "Original note", exact: true });
  await note.getByText(proof.originalText, { exact: true }).waitFor();
  const link = await note.getByRole("link", { name: "Link to original note", exact: true }).getAttribute("href");
  assert.ok(link);
  const linkedNote = new URL(link, workspace);
  assert.equal(linkedNote.origin, origin);
  assert.equal(linkedNote.searchParams.get("history"), "chg_observation_history_start");
  assert.equal(linkedNote.searchParams.get("note"), proof.notePath);
  await coordinator.goto(linkedNote.href);
  await note.getByText(proof.originalText, { exact: true }).waitFor();
  await coordinator.screenshot({ path: output + "/workspace-product-history.png" });
  await coordinator.close();
}

async function verifyMarketingLayout(page: Page, origin: string, output: string) {
  const direct = await page.request.get(origin);
  assert.equal(direct.status(), 200);
  assert.doesNotMatch(await direct.text(), /Field Notes|Harbor Atlas|local-coordinator|\/api\/repos\/1001/u);
  const headline = page.getByRole("heading", { level: 1 });
  assert.equal((await headline.innerText()).replace(/\s+/gu, " "), "Your codebase. In a Nutshell.");
  const title = await headline.evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize), spacing: parseFloat(style.letterSpacing), color: style.color };
  });
  assert.ok(title.size >= 48 && title.size <= 64);
  assert.ok(Math.abs(title.spacing / title.size + 0.03) < 0.001);
  assert.equal(title.color, "rgb(255, 255, 255)");
  const subtitle = page.getByText("Shared project memory, connected features, and clear change history for teams building with AI.", { exact: true });
  assert.equal(await subtitle.evaluate((element) => getComputedStyle(element).color), "rgb(153, 153, 153)");
  const cta = page.getByRole("link", { name: "Open local alpha", exact: true });
  const button = await cta.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.backgroundColor, style.color, style.borderRadius];
  });
  assert.deepEqual(button, ["rgb(127, 109, 242)", "rgb(22, 22, 22)", "4px"]);
  assert.equal(await page.locator("a.primary-cta").count(), 1);
  assert.equal(await cta.getAttribute("href"), "/login");
  const header = page.getByRole("banner");
  assert.match(await header.evaluate((element) => getComputedStyle(element).backgroundColor), /^rgba\(/u);
  const nav = header.getByRole("navigation", { name: "Main navigation", exact: true });
  const row = await nav.getByRole("link").evaluateAll((links) => links.map((link) => {
    const box = link.getBoundingClientRect();
    return box.y + box.height / 2;
  }));
  assert.equal(row.length, 4);
  assert.ok(Math.max(...row) - Math.min(...row) <= 2);
  const logo = header.locator("img");
  const logoSrc = await logo.getAttribute("src");
  assert.ok(logoSrc);
  const logoUrl = new URL(logoSrc, origin);
  assert.equal(logoUrl.origin, origin);
  const artwork = await page.request.get(logoUrl.href);
  assert.equal(artwork.status(), 200);
  const original = await readFile("assets/brand/nutshell-logo.png");
  assert.equal(createHash("sha256").update(original).digest("hex"), "e5bf6e6c8ab5b8c732df625df393265bd6aafeed633dc38d8e70b5c884963fbd");
  assert.deepEqual(await artwork.body(), original);
  assert.deepEqual(await logo.evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }), [567, 523]);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: output + "/entry-desktop.png" });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: output + "/entry-1280x800.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function verifyMarketingPreview(page: Page, browser: Browser, origin: string, output: string) {
  const protectedRequests: string[] = [];
  function trackRequest(request: Request) {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(?:repos|auth|github)(?:\/|$)/u.test(path)) protectedRequests.push(path);
  }
  page.on("request", trackRequest);
  try {
    await page.goto(origin);
    await verifyMarketingLayout(page, origin, output);
    const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
    assert.equal(await navigation.getByRole("link", { name: "Sign in", exact: true }).getAttribute("href"), "/login");
    await navigation.getByRole("link", { name: "Product", exact: true }).press("Enter");
    await page.waitForURL("**/#product");
    const preview = page.getByRole("region", { name: "Editor and graph demo", exact: true });
    await preview.getByText("Demo", { exact: true }).waitFor();
    const documentSelect = preview.getByLabel("Demo document", { exact: true });
    await documentSelect.selectOption({ label: "Release checklist" });
    const editor = preview.getByRole("textbox", { name: "Markdown editor", exact: true });
    await editor.getByText(/Release checklist/u).first().waitFor();
    assert.equal(await editor.getAttribute("contenteditable"), "false");
    await preview.getByRole("button", { name: "Source", exact: true }).press("Enter");
    await editor.getByText(/# Release checklist/u).first().waitFor();

    const canvas = preview.getByRole("region", { name: "Graph canvas", exact: true });
    await canvas.getByRole("button", { name: "Telemetry", exact: true }).press("Enter");
    const selected = preview.getByRole("complementary", { name: "Selected graph item", exact: true });
    await selected.getByRole("heading", { name: "Telemetry", exact: true }).waitFor();
    await selected.getByRole("button", { name: "Open note", exact: true }).click();
    assert.equal(await documentSelect.locator("option:checked").innerText(), "Telemetry");
    await editor.getByText(/soil_moisture_pct/u).first().waitFor();
    const viewport = canvas.locator(".react-flow__viewport");
    const beforeZoom = await viewport.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
    await canvas.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForFunction((initial) => {
      const element = document.querySelector("[aria-label='Graph canvas'] .react-flow__viewport");
      return element && new DOMMatrix(getComputedStyle(element).transform).a > initial;
    }, beforeZoom);

    await page.setViewportSize({ width: 1440, height: 200 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => document.querySelector("[aria-label='Graph canvas']")?.getAttribute("data-layout") === "inactive");
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigation.getByRole("link", { name: "How it works", exact: true }).press("Enter");
    await page.waitForURL("**/#how-it-works");
    assert.equal(await page.locator("#how-it-works").count(), 1);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    mobile.on("request", trackRequest);
    try {
      await mobile.goto(origin);
      const nav = mobile.getByRole("navigation", { name: "Main navigation", exact: true });
      const menu = nav.locator("summary").filter({ hasText: /^Menu$/u });
      await menu.press("Enter");
      await nav.getByRole("link", { name: "Product", exact: true }).press("Enter");
      await mobile.waitForURL("**/#product");
      const open = mobile.getByRole("button", { name: "Open full demo", exact: true });
      await open.press("Enter");
      const dialog = mobile.getByRole("dialog", { name: "Full demo", exact: true });
      await dialog.getByLabel("Demo document", { exact: true }).selectOption({ label: "Ground station" });
      await dialog.getByRole("textbox", { name: "Markdown editor", exact: true }).getByText(/Ground station/u).first().waitFor();
      await dialog.locator("[aria-label='Graph canvas'][data-motion='reduced']").waitFor();
      assert.ok(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1));
      await mobile.screenshot({ path: output + "/entry-full-demo-mobile.png" });
      await mobile.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await open.evaluate((element) => element === document.activeElement), true);
      for (const width of [390, 320]) {
        await mobile.setViewportSize({ width, height: 844 });
        await mobile.evaluate(() => window.scrollTo(0, 0));
        assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        const size = await mobile.getByRole("heading", { level: 1 }).evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
        assert.ok(size >= 48 && size <= 64);
        if (width === 390) await mobile.screenshot({ path: output + "/entry-mobile.png" });
      }
      // A 1440 × 900 window presents this CSS viewport at 200% zoom.
      await mobile.setViewportSize({ width: 720, height: 450 });
      await mobile.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(await mobile.getByRole("link", { name: "Open local alpha", exact: true }).isVisible());
      await mobile.screenshot({ path: output + "/entry-reflow-720x450.png" });
    } finally {
      mobile.off("request", trackRequest);
      await mobile.close();
    }
    assert.deepEqual(protectedRequests, []);
  } finally {
    page.off("request", trackRequest);
  }
}

export async function verifyEntryFlow(origin: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(".local/playwright-preflight/browsers")) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(".local/playwright-preflight/browsers");
  }
  const { chromium, firefox } = await import("playwright");
  const browserType = process.platform === "win32" ? firefox : chromium;
  const server = await browserType.launchServer({ headless: true, host: "127.0.0.1", timeout: 30_000 });
  let journeyFailure: { error: unknown } | null = null;
  let client: Browser | null = null;
  const disconnect = () => { void client?.close().catch(() => {}); };
  signal?.addEventListener("abort", disconnect, { once: true });
  try {
    signal?.throwIfAborted();
    const browser = await browserType.connect(server.wsEndpoint(), { timeout: 10_000 });
    client = browser;
    signal?.throwIfAborted();
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
    await verifyMarketingPreview(page, browser, origin, output);
    await page.getByRole("link", { name: "Open local alpha" }).click();
    await signIn(page, /^Coordinator/);
    const signedInPublic = await page.request.get(origin);
    assert.equal(signedInPublic.status(), 200);
    assert.doesNotMatch(await signedInPublic.text(), /Field Notes|Harbor Atlas|local-coordinator|\/api\/repos\/1001/u);
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
    const newNotePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyNewMarkdownNote(newNotePage, reader, other, origin, output);
    const graphPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyWorkspaceGraphs(graphPage, origin, output);
    const evidencePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyScreenshotEvidence(evidencePage, reader, other, origin, output);
    const historyPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, storageState: { cookies, origins: [] } });
    await verifyProductHistory(historyPage, reader, other, origin, output);
    await reader.close();
    await other.close();
  } catch (error) {
    journeyFailure = { error };
  } finally {
    signal?.removeEventListener("abort", disconnect);
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
  console.log(`${browserType.name()} entry, signed fixture setup, workspace, repository tasks and notes, private drafts, managed Markdown creation and simulated publication, both graph modes, private screenshot evidence, durable product history, and browser shutdown passed.`);
}
