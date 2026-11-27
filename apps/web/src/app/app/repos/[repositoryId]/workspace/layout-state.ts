export type SplitDirection = "right" | "down";
export type DockSide = "left" | "right";
export type DockModule = "explorer" | "details";
export type WorkspaceSize = { width: number; height: number };

export type PaneNode = { kind: "pane"; id: string; tabs: string[]; activeTabId: string | null };
export type SplitNode = {
  kind: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};
export type LayoutNode = PaneNode | SplitNode;
export type DockState = { open: boolean; width: number; modules: DockModule[] };
export type WorkspaceLayout = {
  version: 1;
  root: LayoutNode;
  activePaneId: string;
  docks: Record<DockSide, DockState>;
};

export type WorkspaceLayoutAction =
  | { type: "activate-pane"; paneId: string }
  | { type: "open-tab"; tabId: string; paneId?: string }
  | { type: "activate-tab" | "close-tab"; paneId: string; tabId: string }
  | { type: "move-tab"; fromPaneId: string; toPaneId: string; tabId: string; index?: number }
  | { type: "split-pane"; paneId: string; direction: SplitDirection; available: WorkspaceSize }
  | { type: "close-pane"; paneId: string }
  | { type: "resize-split"; splitId: string; ratio: number; available: WorkspaceSize }
  | { type: "toggle-dock"; side: DockSide }
  | { type: "resize-dock"; side: DockSide; width: number }
  | { type: "move-module"; module: DockModule; side: DockSide };

export const minimumPaneSize = { width: 280, height: 180 } as const;
export const splitDividerSize = 6;
export const maximumOpenPanes = 16;
export const maximumOpenTabs = 256;
const maximumStoredLength = 2 * 1024 * 1024;
const dockWidth = { default: 220, min: 160, max: 420 } as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function validTabId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2048 && value.isWellFormed() && !/\p{Cc}/u.test(value);
}

export function createWorkspaceLayout(initialTabId?: string): WorkspaceLayout {
  const activeTabId = validTabId(initialTabId) ? initialTabId : null;
  return {
    version: 1,
    root: { kind: "pane", id: "pane-1", tabs: activeTabId ? [activeTabId] : [], activeTabId },
    activePaneId: "pane-1",
    docks: {
      left: { open: true, width: dockWidth.default, modules: ["explorer"] },
      right: { open: true, width: dockWidth.default, modules: ["details"] },
    },
  };
}

export function listPanes(root: LayoutNode): PaneNode[] {
  if (root.kind === "pane") return [root];
  return [...listPanes(root.first), ...listPanes(root.second)];
}

function findNode(root: LayoutNode, predicate: (node: LayoutNode) => boolean): LayoutNode | undefined {
  if (predicate(root)) return root;
  if (root.kind === "split") return findNode(root.first, predicate) ?? findNode(root.second, predicate);
}

export function findPane(root: LayoutNode, paneId: string): PaneNode | undefined {
  const pane = findNode(root, (node) => node.id === paneId);
  return pane?.kind === "pane" ? pane : undefined;
}

export function findPaneSplit(root: LayoutNode, paneId: string): SplitNode | undefined {
  const parent = findNode(root, (node) => node.kind === "split" && (node.first.id === paneId || node.second.id === paneId));
  return parent?.kind === "split" ? parent : undefined;
}

function replaceNode(root: LayoutNode, replacement: LayoutNode, id = replacement.id): LayoutNode {
  if (root.id === id) return replacement;
  if (root.kind === "pane") return root;
  const first = replaceNode(root.first, replacement, id);
  const second = replaceNode(root.second, replacement, id);
  return first === root.first && second === root.second ? root : { ...root, first, second };
}

function availableId(root: LayoutNode, kind: "pane" | "split") {
  let index = 1;
  while (findNode(root, (node) => node.id === `${kind}-${index}`)) index++;
  return `${kind}-${index}`;
}

function splitMinimum(direction: SplitDirection, first: WorkspaceSize, second: WorkspaceSize): WorkspaceSize {
  return direction === "right"
    ? { width: first.width + second.width + splitDividerSize, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + second.height + splitDividerSize };
}

export function getMinimumLayoutSize(root: LayoutNode): WorkspaceSize {
  if (root.kind === "pane") return minimumPaneSize;
  return splitMinimum(root.direction, getMinimumLayoutSize(root.first), getMinimumLayoutSize(root.second));
}

function fits(available: WorkspaceSize, minimum: WorkspaceSize) {
  return Number.isFinite(available.width) && Number.isFinite(available.height) &&
    available.width + 1e-6 >= minimum.width && available.height + 1e-6 >= minimum.height;
}

export function canSplitPane(available: WorkspaceSize, direction: SplitDirection) {
  return fits(available, splitMinimum(direction, minimumPaneSize, minimumPaneSize));
}

export function getSplitRatioBounds(split: SplitNode, available: WorkspaceSize) {
  const first = getMinimumLayoutSize(split.first);
  const second = getMinimumLayoutSize(split.second);
  if (!fits(available, splitMinimum(split.direction, first, second))) return null;
  const dimension = split.direction === "right" ? "width" : "height";
  const span = available[dimension] - splitDividerSize;
  const min = first[dimension] / span;
  return { min, max: Math.max(min, 1 - second[dimension] / span) };
}

export function fitLayoutTree(root: LayoutNode, available: WorkspaceSize): LayoutNode | null {
  if (root.kind === "pane") return fits(available, minimumPaneSize) ? root : null;
  const bounds = getSplitRatioBounds(root, available);
  if (!bounds) return null;

  const ratio = clamp(root.ratio, bounds.min, bounds.max);
  const dimension = root.direction === "right" ? "width" : "height";
  const span = available[dimension] - splitDividerSize;
  const first = fitLayoutTree(root.first, { ...available, [dimension]: span * ratio });
  const second = fitLayoutTree(root.second, { ...available, [dimension]: span * (1 - ratio) });
  if (!first || !second) return null;
  return ratio === root.ratio && first === root.first && second === root.second ? root : { ...root, ratio, first, second };
}

function focusPane(state: WorkspaceLayout, pane: PaneNode): WorkspaceLayout {
  const root = replaceNode(state.root, pane);
  return root === state.root && state.activePaneId === pane.id ? state : { ...state, root, activePaneId: pane.id };
}

function removeTab(pane: PaneNode, tabId: string): PaneNode {
  const index = pane.tabs.indexOf(tabId);
  if (index < 0) return pane;
  const tabs = pane.tabs.filter((tab) => tab !== tabId);
  const activeTabId = pane.activeTabId === tabId ? tabs[index] ?? tabs[index - 1] ?? null : pane.activeTabId;
  return { ...pane, tabs, activeTabId };
}

function moveTab(state: WorkspaceLayout, action: Extract<WorkspaceLayoutAction, { type: "move-tab" }>): WorkspaceLayout {
  const source = findPane(state.root, action.fromPaneId);
  const target = findPane(state.root, action.toPaneId);
  if (!source?.tabs.includes(action.tabId) || !target) return state;

  let tabs = target.tabs;
  if (action.index !== undefined || !tabs.includes(action.tabId)) {
    tabs = tabs.filter((tab) => tab !== action.tabId);
    const index = typeof action.index === "number" && Number.isInteger(action.index)
      ? clamp(action.index, 0, tabs.length) : tabs.length;
    tabs.splice(index, 0, action.tabId);
  }

  const root = source === target ? state.root : replaceNode(state.root, removeTab(source, action.tabId));
  const updatedTarget = tabs === target.tabs && target.activeTabId === action.tabId ? target : { ...target, tabs, activeTabId: action.tabId };
  return focusPane(root === state.root ? state : { ...state, root }, updatedTarget);
}

function closePane(state: WorkspaceLayout, paneId: string): WorkspaceLayout {
  const pane = findPane(state.root, paneId);
  const parent = findPaneSplit(state.root, paneId);
  if (!pane || !parent) return state;

  const isFirst = parent.first === pane;
  const sibling = isFirst ? parent.second : parent.first;
  const neighbors = listPanes(sibling);
  const nearest = (isFirst ? neighbors[0] : neighbors.at(-1))!;
  const wasFocused = state.activePaneId === paneId;
  const migrated = {
    ...nearest,
    tabs: [...new Set([...nearest.tabs, ...pane.tabs])],
    activeTabId: (wasFocused ? pane.activeTabId : nearest.activeTabId) ?? nearest.activeTabId ?? pane.activeTabId,
  };
  return {
    ...state,
    root: replaceNode(state.root, replaceNode(sibling, migrated), parent.id),
    activePaneId: wasFocused ? nearest.id : state.activePaneId,
  };
}

export function workspaceLayoutReducer(state: WorkspaceLayout, action: WorkspaceLayoutAction): WorkspaceLayout {
  switch (action.type) {
    case "activate-pane": {
      const pane = findPane(state.root, action.paneId);
      return pane ? focusPane(state, pane) : state;
    }
    case "open-tab":
    case "activate-tab": {
      const pane = findPane(state.root, action.paneId ?? state.activePaneId);
      if (!pane || !validTabId(action.tabId)) return state;
      if (pane.activeTabId === action.tabId) return focusPane(state, pane);
      if (pane.tabs.includes(action.tabId)) return focusPane(state, { ...pane, activeTabId: action.tabId });
      if (action.type === "activate-tab" || listPanes(state.root).reduce((sum, leaf) => sum + leaf.tabs.length, 0) >= maximumOpenTabs) return state;
      return focusPane(state, { ...pane, tabs: [...pane.tabs, action.tabId], activeTabId: action.tabId });
    }
    case "close-tab": {
      const pane = findPane(state.root, action.paneId);
      if (!pane) return state;
      const updated = removeTab(pane, action.tabId);
      return updated === pane ? state : { ...state, root: replaceNode(state.root, updated) };
    }
    case "move-tab":
      return moveTab(state, action);
    case "split-pane": {
      const pane = findPane(state.root, action.paneId);
      if (!pane || !canSplitPane(action.available, action.direction)) return state;
      const panes = listPanes(state.root);
      if (panes.length >= maximumOpenPanes || (pane.activeTabId && panes.reduce((sum, leaf) => sum + leaf.tabs.length, 0) >= maximumOpenTabs)) return state;
      const next: PaneNode = {
        kind: "pane", id: availableId(state.root, "pane"),
        activeTabId: pane.activeTabId, tabs: pane.activeTabId ? [pane.activeTabId] : [],
      };
      const split: SplitNode = { kind: "split", id: availableId(state.root, "split"), direction: action.direction, ratio: 0.5, first: pane, second: next };
      return { ...state, root: replaceNode(state.root, split, pane.id), activePaneId: next.id };
    }
    case "close-pane":
      return closePane(state, action.paneId);
    case "resize-split": {
      const split = findNode(state.root, (node) => node.id === action.splitId);
      if (split?.kind !== "split" || !Number.isFinite(action.ratio)) return state;
      const bounds = getSplitRatioBounds(split, action.available);
      if (!bounds) return state;
      const ratio = clamp(action.ratio, bounds.min, bounds.max);
      return split.ratio === ratio ? state : { ...state, root: replaceNode(state.root, { ...split, ratio }) };
    }
    case "toggle-dock": {
      const dock = state.docks[action.side];
      return { ...state, docks: { ...state.docks, [action.side]: { ...dock, open: !dock.open } } };
    }
    case "resize-dock": {
      const dock = state.docks[action.side];
      if (!Number.isFinite(action.width)) return state;
      const width = clamp(Math.round(action.width), dockWidth.min, dockWidth.max);
      return width === dock.width ? state : { ...state, docks: { ...state.docks, [action.side]: { ...dock, width } } };
    }
    case "move-module": {
      const target = state.docks[action.side];
      if (target.modules.includes(action.module)) return state;
      const source = action.side === "left" ? "right" : "left";
      const docks = { ...state.docks };
      docks[source] = { ...docks[source], modules: docks[source].modules.filter((module) => module !== action.module) };
      docks[action.side] = { ...target, open: true, modules: [...target.modules, action.module] };
      return { ...state, docks };
    }
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function restoreDocks(value: unknown, defaults: WorkspaceLayout["docks"]): WorkspaceLayout["docks"] {
  const saved = object(value);
  if (!saved) return defaults;
  const seen = new Set<DockModule>();
  function restoreDock(side: DockSide): DockState {
    const dock = object(saved?.[side]);
    const modules: DockModule[] = [];
    if (Array.isArray(dock?.modules)) {
      for (const module of dock.modules.slice(0, 2)) {
        if ((module === "explorer" || module === "details") && !seen.has(module)) {
          seen.add(module);
          modules.push(module);
        }
      }
    }
    const open = typeof dock?.open === "boolean" ? dock.open : defaults[side].open;
    const width = typeof dock?.width === "number" && Number.isFinite(dock.width)
      ? clamp(Math.round(dock.width), dockWidth.min, dockWidth.max) : dockWidth.default;
    return { open, width, modules };
  }
  const left = restoreDock("left");
  const right = restoreDock("right");
  if (!seen.has("explorer")) left.modules.push("explorer");
  if (!seen.has("details")) right.modules.push("details");
  return { left, right };
}

export function restoreWorkspaceLayout(serialized: string | null, accessibleIds: ReadonlySet<string>, initialTabId?: string): WorkspaceLayout {
  const defaults = createWorkspaceLayout(initialTabId && accessibleIds.has(initialTabId) ? initialTabId : undefined);
  if (!serialized || serialized.length > maximumStoredLength) return defaults;

  const nodeIds = new Set<string>();
  let paneCount = 0;
  let tabCount = 0;
  function parseNode(value: unknown, depth: number): LayoutNode | null {
    const node = object(value);
    if (!node || depth >= maximumOpenPanes || typeof node.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(node.id) || nodeIds.has(node.id)) return null;
    nodeIds.add(node.id);
    if (node.kind === "pane") {
      if (!Array.isArray(node.tabs) || ++paneCount > maximumOpenPanes || (tabCount += node.tabs.length) > maximumOpenTabs) return null;
      const tabs = [...new Set(node.tabs.filter((tab) => validTabId(tab) && accessibleIds.has(tab)))];
      const activeTabId = validTabId(node.activeTabId) && tabs.includes(node.activeTabId) ? node.activeTabId : tabs[0] ?? null;
      return { kind: "pane", id: node.id, tabs, activeTabId };
    }
    if (node.kind !== "split" || (node.direction !== "right" && node.direction !== "down") ||
        typeof node.ratio !== "number" || !(node.ratio > 0 && node.ratio < 1)) return null;
    const first = parseNode(node.first, depth + 1);
    if (!first) return null;
    const second = parseNode(node.second, depth + 1);
    return second ? { kind: "split", id: node.id, direction: node.direction, ratio: node.ratio, first, second } : null;
  }

  try {
    const saved = object(JSON.parse(serialized));
    if (saved?.version !== 1) return defaults;
    const root = parseNode(saved.root, 0);
    if (!root) return defaults;
    const activePaneId = typeof saved.activePaneId === "string" && findPane(root, saved.activePaneId)
      ? saved.activePaneId : listPanes(root)[0]!.id;
    return { version: 1, root, activePaneId, docks: restoreDocks(saved.docks, defaults.docks) };
  } catch {
    return defaults;
  }
}
