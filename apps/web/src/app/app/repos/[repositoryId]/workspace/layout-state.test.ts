import { describe, expect, it } from "vitest";
import {
  canSplitPane, createWorkspaceLayout, findPane, findPaneSplit, fitLayoutTree, getMinimumLayoutSize,
  listPanes, maximumOpenPanes, restoreWorkspaceLayout, workspaceLayoutReducer as reduce,
  type WorkspaceLayout,
} from "./layout-state.ts";

const roomy = { width: 1200, height: 720 };

function splitRight(layout: WorkspaceLayout) {
  return reduce(layout, { type: "split-pane", paneId: layout.activePaneId, direction: "right", available: roomy });
}

describe("workspace pane layout", () => {
  it("duplicates only the selected item on a split and focuses the new pane", () => {
    const initial = createWorkspaceLayout("doc:first");
    const opened = reduce(initial, { type: "open-tab", tabId: "entity:second" });
    const split = splitRight(opened);
    expect(listPanes(split.root)).toEqual([
      { kind: "pane", id: initial.activePaneId, tabs: ["doc:first", "entity:second"], activeTabId: "entity:second" },
      { kind: "pane", id: split.activePaneId, tabs: ["entity:second"], activeTabId: "entity:second" },
    ]);
    expect(split.activePaneId).not.toBe(initial.activePaneId);
    expect(reduce(opened, { type: "split-pane", paneId: opened.activePaneId, direction: "right", available: { width: 565, height: 300 } })).toBe(opened);
    expect(canSplitPane({ width: 566, height: 180 }, "right")).toBe(true);
    expect(canSplitPane({ width: 279, height: 900 }, "down")).toBe(false);
  });

  it("fits nested panes on both axes and protects the saved preference on a narrow viewport", () => {
    const initial = createWorkspaceLayout("note");
    const first = splitRight(initial);
    const nested = reduce(first, { type: "split-pane", paneId: initial.activePaneId, direction: "down", available: roomy });
    expect(listPanes(nested.root)).toHaveLength(3);
    expect(getMinimumLayoutSize(nested.root)).toEqual({ width: 566, height: 366 });
    const parent = findPaneSplit(nested.root, initial.activePaneId)!;
    const resized = reduce(nested, { type: "resize-split", splitId: parent.id, ratio: 0.01, available: { width: 500, height: 600 } });
    expect(findPaneSplit(resized.root, initial.activePaneId)?.ratio).toBeCloseTo(180 / 594);
    expect(fitLayoutTree(resized.root, { width: 390, height: 844 })).toBeNull();
    const fitted = fitLayoutTree(resized.root, { width: 566, height: 366 })!;
    expect(listPanes(fitted)).toEqual(listPanes(resized.root));
    expect(findPaneSplit(fitted, initial.activePaneId)?.ratio).toBe(0.5);
    expect(findPaneSplit(resized.root, initial.activePaneId)?.ratio).toBeCloseTo(180 / 594);
  });

  it("deduplicates moved tabs, reorders within a pane, and activates the adjacent tab on close", () => {
    const initial = createWorkspaceLayout("shared");
    const split = splitRight(initial);
    const moved = reduce(split, { type: "move-tab", fromPaneId: initial.activePaneId, toPaneId: split.activePaneId, tabId: "shared" });
    expect(findPane(moved.root, initial.activePaneId)?.tabs).toEqual([]);
    expect(findPane(moved.root, moved.activePaneId)?.tabs).toEqual(["shared"]);
    const opened = reduce(moved, { type: "open-tab", tabId: "details" });
    const reordered = reduce(opened, { type: "move-tab", fromPaneId: opened.activePaneId, toPaneId: opened.activePaneId, tabId: "details", index: 0 });
    expect(findPane(reordered.root, reordered.activePaneId)?.tabs).toEqual(["details", "shared"]);
    const closed = reduce(reordered, { type: "close-tab", paneId: reordered.activePaneId, tabId: "details" });
    expect(findPane(closed.root, closed.activePaneId)).toMatchObject({ tabs: ["shared"], activeTabId: "shared" });
    expect(reduce(closed, { type: "activate-tab", paneId: closed.activePaneId, tabId: "missing" })).toBe(closed);
  });

  it("moves a closed pane's tabs to the nearest sibling leaf without losing focus or tab order", () => {
    const initial = createWorkspaceLayout("left");
    const split = splitRight(initial);
    const right = reduce(split, { type: "open-tab", tabId: "right" });
    const nested = reduce(right, { type: "split-pane", paneId: right.activePaneId, direction: "down", available: roomy });
    const bottom = reduce(nested, { type: "open-tab", tabId: "bottom" });
    const focused = reduce(bottom, { type: "activate-pane", paneId: initial.activePaneId });
    const closed = reduce(focused, { type: "close-pane", paneId: focused.activePaneId });
    expect(closed.activePaneId).toBe(right.activePaneId);
    expect(listPanes(closed.root).map(({ tabs, activeTabId }) => ({ tabs, activeTabId }))).toEqual([
      { tabs: ["left", "right"], activeTabId: "left" },
      { tabs: ["right", "bottom"], activeTabId: "bottom" },
    ]);
    expect(reduce(initial, { type: "close-pane", paneId: initial.activePaneId })).toBe(initial);
  });

  it("bounds recursive panes while letting users close a pane to recover a slot", () => {
    let layout = createWorkspaceLayout("book");
    for (let count = 1; count < maximumOpenPanes; count++) layout = splitRight(layout);
    expect(listPanes(layout.root)).toHaveLength(maximumOpenPanes);
    expect(splitRight(layout)).toBe(layout);
    let restored = restoreWorkspaceLayout(JSON.stringify(layout), new Set(["book"]));
    expect(restored).toEqual(layout);
    restored = reduce(restored, { type: "close-pane", paneId: restored.activePaneId });
    expect(listPanes(splitRight(restored).root)).toHaveLength(maximumOpenPanes);
  });
});

describe("workspace preference restore", () => {
  it("restores only accessible items with a safe fallback for unavailable focus", () => {
    const initial = createWorkspaceLayout("allowed");
    const focused = reduce(initial, { type: "open-tab", tabId: "removed" });
    const split = splitRight(focused);
    const stored = JSON.stringify({ ...split, activePaneId: "does-not-exist" });
    const restored = restoreWorkspaceLayout(stored, new Set(["allowed"]));
    expect(restored.activePaneId).toBe(initial.activePaneId);
    expect(listPanes(restored.root).map(({ tabs, activeTabId }) => ({ tabs, activeTabId }))).toEqual([
      { tabs: ["allowed"], activeTabId: "allowed" }, { tabs: [], activeTabId: null },
    ]);
  });

  it("preserves independent dock state, relocates modules and restores older preferences without widths", () => {
    const initial = createWorkspaceLayout();
    const closed = reduce(initial, { type: "toggle-dock", side: "right" });
    expect(closed.docks.left.open).toBe(true);
    expect(closed.docks.right.open).toBe(false);
    const moved = reduce(closed, { type: "move-module", side: "right", module: "explorer" });
    const resized = reduce(moved, { type: "resize-dock", side: "right", width: 500 });
    expect(resized.docks).toEqual({
      left: { open: true, width: 220, modules: [] },
      right: { open: true, width: 420, modules: ["details", "explorer"] },
    });
    expect(restoreWorkspaceLayout(JSON.stringify(resized), new Set())).toEqual(resized);
    const old = JSON.stringify({ ...resized, docks: { ...resized.docks, right: { open: false, modules: ["details", "explorer"] } } });
    expect(restoreWorkspaceLayout(old, new Set()).docks.right).toEqual({ open: false, width: 220, modules: ["details", "explorer"] });
  });

  it("discards corrupted, excessively large, duplicate-node, and unsupported-version preferences", () => {
    const initial = createWorkspaceLayout("safe");
    const split = splitRight(initial);
    const duplicate = { ...split, root: { ...split.root, first: initial.root, second: initial.root } };
    for (const value of ["{", "[]", " ".repeat(2 * 1024 * 1024 + 1), JSON.stringify(duplicate), JSON.stringify({ ...initial, version: 2 })]) {
      expect(restoreWorkspaceLayout(value, new Set(["safe"]), "safe")).toEqual(initial);
    }
    expect(restoreWorkspaceLayout(null, new Set(["safe"]), "unauthorized")).toEqual(createWorkspaceLayout());
  });
});
