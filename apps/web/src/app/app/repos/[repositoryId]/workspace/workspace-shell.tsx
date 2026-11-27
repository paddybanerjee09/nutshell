"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from "react";
import { ArrowLeft, Box, Boxes, ChevronRight, FileText, FolderClosed, FolderTree, History, ListTodo, Network, NotebookText, PanelRight, Search, X } from "lucide-react";
import {
  canSplitPane,
  createWorkspaceLayout,
  findPane,
  findPaneSplit,
  fitLayoutTree,
  getSplitRatioBounds,
  listPanes,
  maximumOpenPanes,
  maximumOpenTabs,
  minimumPaneSize,
  restoreWorkspaceLayout,
  splitDividerSize,
  workspaceLayoutReducer,
} from "./layout-state";
import type { DockModule, DockSide, LayoutNode, PaneNode, SplitDirection, WorkspaceLayoutAction, WorkspaceSize } from "./layout-state";
import { CommandPalette, IconButton, PaneMenu, ResizeHandle } from "./pane-controls";
import type { WorkspaceCommand } from "./pane-controls";
import { documentModeLabels, WorkspaceContent, WorkspaceDetails, WorkspaceStatus } from "./workspace-content";
import type { DocumentMode } from "./workspace-content";
import type { WorkspaceData, WorkspaceItem } from "./workspace-data";
import { WorkspaceDraftProvider } from "./workspace-drafts";
import { graphTitles, WorkspaceGraphPanel } from "./workspace-graph-panel";
import { WorkspaceHistoryPanel, type HistoryFocus } from "./workspace-history-panel";
import { historyTabId, WorkspaceHistoryProvider } from "./workspace-history";
import { WorkspaceTaskPanel } from "./workspace-task-panel";
import { WorkspaceTasksProvider } from "./workspace-tasks";
import { WorkspaceTeamNotePanel } from "./workspace-team-note-panel";
import { WorkspaceTeamNotesProvider } from "./workspace-team-notes";

const sides: DockSide[] = ["left", "right"];
const moduleLabels: Record<DockModule, string> = { explorer: "Explorer", details: "Details" };
const layoutBreakpoint = 1_024;
const dockWidthBounds = { min: 160, max: 420 };
const workspaceTabs = [
  { id: "view:memory-graph", title: graphTitles.memory, kind: "graph", mode: "memory", icon: Network },
  { id: "view:product-map", title: graphTitles.product, kind: "graph", mode: "product", icon: Boxes },
  { id: historyTabId, title: "History", kind: "history", icon: History },
  { id: "view:team-tasks", title: "Team tasks", kind: "tasks", icon: ListTodo },
  { id: "view:team-notes", title: "Team notes", kind: "notes", icon: NotebookText },
] as const;
const workspaceTabsById = new Map<string, (typeof workspaceTabs)[number]>(workspaceTabs.map((tab) => [tab.id, tab]));

type ExplorerFolder = { folders: Map<string, ExplorerFolder>; items: WorkspaceItem[] };
type DraggedTab = { paneId: string; tabId: string };

function explorerFolders(items: WorkspaceItem[]): ExplorerFolder {
  const root: ExplorerFolder = { folders: new Map(), items: [] };
  for (const item of items) {
    if (item.kind !== "document") continue;
    const parts = item.path.split("/").slice(0, -1);
    let folder = root;
    for (const name of parts) {
      let child = folder.folders.get(name);
      if (!child) {
        child = { folders: new Map(), items: [] };
        folder.folders.set(name, child);
      }
      folder = child;
    }
    folder.items.push(item);
  }
  return root;
}

function ExplorerList({ folder, activeId, open, level = 0 }: {
  folder: ExplorerFolder;
  activeId: string | null;
  open: (id: string) => void;
  level?: number;
}) {
  const folders = [...folder.folders].sort(([left], [right]) => left.localeCompare(right));
  const items = [...folder.items].sort((left, right) => left.path.localeCompare(right.path));

  return (
    <ul>
      {folders.map(([name, child]) => (
        <li key={name}>
          <details className="workspace-tree-group" open={level === 0 || undefined}>
            <summary className="workspace-tree-folder">
              <ChevronRight className="workspace-tree-arrow" size={16} strokeWidth={1.5} aria-hidden="true" />
              <FolderClosed size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{name}</span>
            </summary>
            <ExplorerList folder={child} activeId={activeId} open={open} level={level + 1} />
          </details>
        </li>
      ))}
      {items.map((item) => <ExplorerItem key={item.id} item={item} active={activeId === item.id} open={open} />)}
    </ul>
  );
}

function ExplorerItem({ item, active, open }: { item: WorkspaceItem; active: boolean; open: (id: string) => void }) {
  const Icon = item.kind === "document" ? FileText : Box;
  const label = item.kind === "document" ? item.path.split("/").at(-1) : item.title;
  return (
    <li>
      <button
        className="workspace-tree-item"
        type="button"
        data-active={active}
        aria-current={active || undefined}
        aria-label={item.kind === "document" ? item.path : item.title}
        title={item.path}
        onClick={() => open(item.id)}
      >
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        <span>{label}</span>
      </button>
    </li>
  );
}

export function WorkspaceShell({ data, initialHistory }: { data: WorkspaceData; initialHistory?: HistoryFocus }) {
  const instanceId = useId();
  const main = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const palette = useRef<HTMLDialogElement>(null);
  const paletteTrigger = useRef<HTMLElement | null>(null);
  const drawerTrigger = useRef<DockModule | null>(null);
  const dragged = useRef<DraggedTab | null>(null);
  const historyRequest = useRef(0);
  const [layout, setLayout] = useState(() => createWorkspaceLayout(data.initialItemId ?? undefined));
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, center: { width: 0, height: 0 } });
  const [drawer, setDrawer] = useState<DockSide | null>(null);
  const [notice, setNotice] = useState("");
  const [documentModes, setDocumentModes] = useState<Record<string, { itemId: string; mode: DocumentMode }>>({});
  const [historyTargets, setHistoryTargets] = useState<Record<string, { focus: HistoryFocus; request: number }>>({});
  const itemsById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const folders = useMemo(() => explorerFolders(data.items), [data.items]);
  const entities = useMemo(() => data.items.filter((item) => item.kind === "entity"), [data.items]);
  const panes = listPanes(layout.root);
  const tabCount = panes.reduce((count, pane) => count + pane.tabs.length, 0);
  const activePane = findPane(layout.root, layout.activePaneId) ?? panes[0]!;
  const activeItem = activePane.activeTabId ? itemsById.get(activePane.activeTabId) ?? null : null;
  const activeView = documentModes[activePane.id];
  const dockWidth = sides.reduce((width, side) => {
    const dock = layout.docks[side];
    return width + (dock.open && dock.modules.length ? dock.width : 0);
  }, 0);
  const compact = size.width > 0 && (
    size.width <= layoutBreakpoint || size.width - 40 - dockWidth < minimumPaneSize.width
  );
  const fitted = compact ? null : size.center.width > 0 ? fitLayoutTree(layout.root, size.center) : layout.root;
  const visibleLayout = fitted ?? activePane;

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(data.layoutKey);
    } catch {
      // The workspace also works when browser preferences are disabled.
    }
    const restored = restoreWorkspaceLayout(saved, new Set([...itemsById.keys(), ...workspaceTabsById.keys()]), data.initialItemId ?? undefined);
    if (initialHistory) {
      const paneId = restored.activePaneId;
      setHistoryTargets((current) => current[paneId] ? current : { ...current, [paneId]: { focus: initialHistory, request: 0 } });
      setLayout(workspaceLayoutReducer(restored, { type: "open-tab", paneId, tabId: historyTabId }));
    } else setLayout(restored);
    setRestoredKey(data.layoutKey);
  }, [data.initialItemId, data.layoutKey, initialHistory, itemsById]);

  useEffect(() => {
    if (restoredKey !== data.layoutKey) return;
    try {
      window.localStorage.setItem(data.layoutKey, JSON.stringify(layout));
    } catch {
      // A quota or privacy restriction should not affect the open workspace.
    }
  }, [data.layoutKey, layout, restoredKey]);

  useEffect(() => {
    if (!main.current || !center.current) return;
    const mainElement = main.current;
    const centerElement = center.current;
    const observer = new ResizeObserver(() => {
      const { width } = mainElement.getBoundingClientRect();
      const frame = centerElement.getBoundingClientRect();
      setSize((previous) => (
        width === previous.width && frame.width === previous.center.width && frame.height === previous.center.height
          ? previous : { width, center: { width: frame.width, height: frame.height } }
      ));
    });
    observer.observe(mainElement);
    observer.observe(centerElement);
    return () => observer.disconnect();
  }, []);

  const openPalette = useCallback(() => {
    if (!palette.current || palette.current.open) return;
    const focused = document.activeElement;
    paletteTrigger.current = focused instanceof HTMLElement ? focused : null;
    palette.current.showModal();
  }, []);

  useEffect(() => {
    function keyboard(event: globalThis.KeyboardEvent) {
      if (event.isComposing || (!event.ctrlKey && !event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "p") return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || (target !== document.body && !main.current?.parentElement?.contains(target))) return;
      const inEditor = Boolean(target.closest(".cm-content"));
      if ((target.isContentEditable || target.matches("input, textarea, select")) && !inEditor && !palette.current?.contains(target)) return;
      event.preventDefault();
      if (inEditor) event.stopPropagation();
      openPalette();
    }
    document.addEventListener("keydown", keyboard, true);
    return () => document.removeEventListener("keydown", keyboard, true);
  }, [openPalette]);

  function dispatch(action: WorkspaceLayoutAction) {
    setLayout((current) => workspaceLayoutReducer(current, action));
    if (action.type !== "activate-pane") setNotice("");
  }

  function setDocumentMode(paneId: string, itemId: string, mode: DocumentMode) {
    setDocumentModes((current) => ({ ...current, [paneId]: { itemId, mode } }));
  }

  function viewId(kind: string, id: string) {
    return instanceId + "-" + kind + "-" + id;
  }

  function focusPane(paneId?: string, panel = false) {
    requestAnimationFrame(() => {
      const pane = paneId ? document.getElementById(viewId("pane", paneId))
        : center.current?.querySelector<HTMLElement>('[data-focused="true"]');
      const target = (!panel && pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')) ||
        pane?.querySelector<HTMLElement>('[role="tabpanel"]');
      target?.focus({ preventScroll: true });
    });
  }

  function openItem(id: string, paneId = activePane.id) {
    if (!itemsById.has(id) && !workspaceTabsById.has(id)) return;
    if (tabCount >= maximumOpenTabs && !findPane(layout.root, paneId)?.tabs.includes(id)) {
      setNotice("Close a tab before opening another item.");
      return;
    }
    dispatch({ type: "open-tab", tabId: id, paneId });
    setDrawer(null);
    focusPane(paneId);
  }

  function openEntityHistory(paneId: string, entityId: string, changeId?: string) {
    const request = ++historyRequest.current;
    const focus = { entityId, ...(changeId ? { changeId } : {}) };
    setHistoryTargets((current) => ({ ...current, [paneId]: { focus, request } }));
    openItem(historyTabId, paneId);
  }

  function nextPane(paneId: string) {
    const index = panes.findIndex((pane) => pane.id === paneId);
    return panes[(index + 1) % panes.length]!;
  }

  function closeTab(paneId: string, tabId: string) {
    dispatch({ type: "close-tab", paneId, tabId });
    focusPane(paneId);
  }

  function splitPane(paneId: string, direction: SplitDirection) {
    const available = document.getElementById(viewId("pane", paneId))?.getBoundingClientRect();
    if (panes.length >= maximumOpenPanes) {
      setNotice("Close a pane before opening another split.");
      return;
    }
    if (tabCount >= maximumOpenTabs && findPane(layout.root, paneId)?.activeTabId) {
      setNotice("Close a tab before splitting this pane.");
      return;
    }
    if (!fitted || !available || !canSplitPane(available, direction)) {
      setNotice("This viewport is too small for another visible pane. The current tab stays open.");
      return;
    }
    dispatch({ type: "split-pane", paneId, available, direction });
    focusPane();
  }

  function paneCommands(pane: PaneNode): WorkspaceCommand[] {
    const split = findPaneSplit(layout.root, pane.id);
    const next = nextPane(pane.id);
    const commands: WorkspaceCommand[] = [
      { id: "split-right", label: "Split right", run: () => splitPane(pane.id, "right") },
      { id: "split-down", label: "Split down", run: () => splitPane(pane.id, "down") },
      { id: "focus-pane", label: "Focus pane content", run: () => focusPane(pane.id, true) },
    ];
    if (split) {
      commands.push(
        { id: "next-pane", label: "Focus next pane", run: () => {
          dispatch({ type: "activate-pane", paneId: next.id });
          focusPane(next.id);
        } },
        { id: "close-pane", label: "Close pane", run: () => {
          dispatch({ type: "close-pane", paneId: pane.id });
          focusPane();
        } },
      );
      if (fitted) commands.push({ id: "resize-split", label: "Resize current split", run: () => {
        document.getElementById(viewId("splitter", split.id))?.focus();
      } });
      if (pane.activeTabId) {
        const tabId = pane.activeTabId;
        commands.push({ id: "move-tab", label: "Move tab to next pane", run: () => {
          dispatch({ type: "move-tab", fromPaneId: pane.id, toPaneId: next.id, tabId });
          focusPane(next.id);
        } });
      }
    }
    if (pane.activeTabId) {
      const tabId = pane.activeTabId;
      const item = itemsById.get(tabId);
      if (item?.kind === "document") {
        for (const mode of Object.keys(documentModeLabels) as DocumentMode[]) {
          commands.push({ id: "view-" + mode, label: documentModeLabels[mode], run: () => {
            setDocumentMode(pane.id, tabId, mode);
            focusPane(pane.id, true);
          } });
        }
      }
      const index = pane.tabs.indexOf(tabId);
      for (const [offset, direction] of [[-1, "left"], [1, "right"]] as const) {
        const next = index + offset;
        if (index < 0 || next < 0 || next >= pane.tabs.length) continue;
        commands.push({ id: "reorder-tab-" + direction, label: "Move active tab " + direction, run: () => {
          dispatch({ type: "move-tab", fromPaneId: pane.id, toPaneId: pane.id, tabId, index: next });
          focusPane(pane.id);
        } });
      }
      commands.push({ id: "close-tab", label: "Close active tab", shortcut: "Delete", run: () => closeTab(pane.id, tabId) });
    }
    return commands;
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, pane: PaneNode, index: number, id: string) {
    if (event.key === "Delete") {
      event.preventDefault();
      closeTab(pane.id, id);
      return;
    }
    const count = pane.tabs.length;
    const position = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : event.key === "ArrowRight" ? (index + 1) % count : event.key === "ArrowLeft" ? (index - 1 + count) % count : -1;
    if (position < 0) return;
    event.preventDefault();
    document.getElementById(viewId("tab-" + pane.id, String(position)))?.focus();
  }

  function dropTab(event: DragEvent, paneId: string, index?: number) {
    if (!dragged.current) return;
    event.preventDefault();
    event.stopPropagation();
    const { paneId: fromPaneId, tabId } = dragged.current;
    dragged.current = null;
    dispatch({ type: "move-tab", fromPaneId, toPaneId: paneId, tabId, index });
    focusPane(paneId);
  }

  function renderNode(node: LayoutNode, available: WorkspaceSize): ReactNode {
    if (node.kind === "split") {
      const axis = node.direction === "right" ? "horizontal" : "vertical";
      const dimension = axis === "horizontal" ? "width" : "height";
      const span = available[dimension] - splitDividerSize;
      const bounds = getSplitRatioBounds(node, available);
      const template = "minmax(0, " + node.ratio + "fr) " + splitDividerSize + "px minmax(0, " + (1 - node.ratio) + "fr)";
      function resize(ratio: number, rect = available) {
        dispatch({ type: "resize-split", splitId: node.id, ratio, available: rect });
      }
      return (
        <div className="workspace-split" data-axis={axis} style={axis === "horizontal" ? { gridTemplateColumns: template } : { gridTemplateRows: template }}>
          {renderNode(node.first, { ...available, [dimension]: span * node.ratio })}
          <ResizeHandle
            id={viewId("splitter", node.id)}
            axis={axis}
            label="Resize pane split"
            value={node.ratio * 100}
            min={(bounds?.min ?? 0) * 100}
            max={(bounds?.max ?? 1) * 100}
            onResize={(value) => resize(value / 100)}
            onPointerResize={(event, rect) => {
              const offset = axis === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
              resize((offset - splitDividerSize / 2) / (rect[dimension] - splitDividerSize), rect);
            }}
          />
          {renderNode(node.second, { ...available, [dimension]: span * (1 - node.ratio) })}
        </div>
      );
    }
    const item = node.activeTabId ? itemsById.get(node.activeTabId) ?? null : null;
    const workspaceTab = node.activeTabId ? workspaceTabsById.get(node.activeTabId) : undefined;
    const view = documentModes[node.id];
    const panelId = viewId("panel", node.id);
    const selectedIndex = node.activeTabId ? node.tabs.indexOf(node.activeTabId) : -1;
    return (
      <section
        id={viewId("pane", node.id)}
        className="workspace-pane"
        aria-label="Workspace pane"
        data-focused={node.id === activePane.id}
        data-pane-id={node.id}
        onFocusCapture={() => dispatch({ type: "activate-pane", paneId: node.id })}
        onPointerDown={() => dispatch({ type: "activate-pane", paneId: node.id })}
      >
        <div className="workspace-pane-header">
          <div
            className="workspace-tabbar"
            role="tablist"
            aria-label="Pane tabs"
            onDragOver={(event) => { if (dragged.current) event.preventDefault(); }}
            onDrop={(event) => dropTab(event, node.id)}
          >
            {node.tabs.map((id, index) => {
              const itemTab = itemsById.get(id);
              const viewTab = workspaceTabsById.get(id);
              const tab = itemTab ?? viewTab;
              if (!tab) return null;
              const TabIcon = viewTab?.icon ?? (itemTab?.kind === "document" ? FileText : Box);
              const selected = node.activeTabId === id;
              return (
                <div className="workspace-tab-slot" data-selected={selected} key={id} onDrop={(event) => dropTab(event, node.id, index)}>
                  <button
                    id={viewId("tab-" + node.id, String(index))}
                    type="button"
                    role="tab"
                    className="workspace-tab"
                    aria-selected={selected}
                    aria-controls={panelId}
                    tabIndex={selected ? 0 : -1}
                    title={itemTab?.path ?? viewTab?.title}
                    draggable
                    onClick={() => dispatch({ type: "activate-tab", paneId: node.id, tabId: id })}
                    onKeyDown={(event) => handleTabKey(event, node, index, id)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", "Nutshell tab");
                      dragged.current = { paneId: node.id, tabId: id };
                    }}
                    onDragEnd={() => { dragged.current = null; }}
                  >
                    <TabIcon size={16} strokeWidth={1.5} aria-hidden="true" />
                    <span>{tab.title}</span>
                  </button>
                  <IconButton icon={X} label={"Close tab " + tab.title} className="workspace-tab-close" tabIndex={selected ? 0 : -1} onClick={() => closeTab(node.id, id)} />
                </div>
              );
            })}
          </div>
          <PaneMenu commands={paneCommands(node)} />
        </div>
        <div
          className="workspace-panel"
          data-kind={workspaceTab?.kind}
          id={panelId}
          role="tabpanel"
          aria-labelledby={selectedIndex >= 0 ? viewId("tab-" + node.id, String(selectedIndex)) : undefined}
          aria-label={selectedIndex < 0 ? "Empty pane" : undefined}
          tabIndex={0}
        >
          {workspaceTab?.kind === "history" ? <WorkspaceHistoryPanel key={historyTargets[node.id]?.request ?? 0}
            data={data} focus={historyTargets[node.id]?.focus} onOpenEntity={(id) => openItem("entity:" + id, node.id)} />
            : workspaceTab?.kind === "notes" ? <WorkspaceTeamNotePanel />
            : workspaceTab?.kind === "tasks" ? <WorkspaceTaskPanel data={data} onOpen={(id) => openItem(id, node.id)} />
            : workspaceTab?.kind === "graph" ? <WorkspaceGraphPanel key={workspaceTab.id} data={data} mode={workspaceTab.mode}
              active={node.id === activePane.id} onOpen={(id) => openItem(id, node.id)} /> : <WorkspaceContent
            item={item}
            items={data.items}
            mode={view && view.itemId === item?.id ? view.mode : undefined}
            indexedRevision={data.revision}
            onModeChange={(mode) => { if (item) setDocumentMode(node.id, item.id, mode); }}
            onOpen={(id) => openItem(id, node.id)}
            onOpenHistory={(entityId, changeId) => openEntityHistory(node.id, entityId, changeId)}
          />}
        </div>
      </section>
    );
  }

  function moduleSide(module: DockModule) {
    return layout.docks.left.modules.includes(module) ? "left" : "right";
  }

  function dockVisible(side: DockSide) {
    const dock = layout.docks[side];
    return dock.modules.length > 0 && (compact ? drawer === side : dock.open);
  }

  function closeDock(side: DockSide) {
    if (compact) setDrawer(null);
    else dispatch({ type: "toggle-dock", side });
    const module = compact ? drawerTrigger.current ?? layout.docks[side].modules[0] : layout.docks[side].modules[0];
    drawerTrigger.current = null;
    if (module) requestAnimationFrame(() => document.getElementById(viewId("ribbon", module))?.focus());
  }

  function toggleModule(module: DockModule) {
    const side = moduleSide(module);
    if (compact) {
      if (drawer === side) closeDock(side);
      else {
        drawerTrigger.current = module;
        setDrawer(side);
        requestAnimationFrame(() => document.getElementById(viewId("close-dock", side))?.focus());
      }
    } else {
      dispatch({ type: "toggle-dock", side });
    }
  }

  function moveModule(module: DockModule, side: DockSide) {
    dispatch({ type: "move-module", module, side });
    if (compact) setDrawer(side);
    requestAnimationFrame(() => document.getElementById(viewId("dock-module", module))?.focus());
  }

  function renderDock(side: DockSide) {
    if (!dockVisible(side)) return null;
    const dock = layout.docks[side];
    const opposite = side === "left" ? "right" : "left";
    return (
      <aside
        className="workspace-sidebar"
        id={viewId("dock", side)}
        data-side={side}
        data-overlay={compact}
        aria-label={(side === "left" ? "Left" : "Right") + " sidebar"}
        style={{ "--workspace-sidebar-size": dock.width + "px" } as CSSProperties}
      >
        <div className="workspace-sidebar-header">
          <span>{data.repositoryName}</span>
          <IconButton icon={X} id={viewId("close-dock", side)} label={"Close " + side + " sidebar"} onClick={() => closeDock(side)} />
        </div>
        {dock.modules.map((module) => (
          <section className="workspace-dock-module" aria-labelledby={viewId("dock-module", module)} key={module}>
            <header className="workspace-dock-header">
              <h2 id={viewId("dock-module", module)} tabIndex={-1}>{moduleLabels[module]}</h2>
              <IconButton
                icon={opposite === "left" ? ArrowLeft : PanelRight}
                label={"Move " + moduleLabels[module] + " to " + opposite + " sidebar"}
                onClick={() => moveModule(module, opposite)}
              />
            </header>
            <div className="workspace-dock-content">
              {module === "details" ? <WorkspaceDetails data={data} item={activeItem} items={data.items} onOpen={openItem} /> : (
                <nav className="workspace-tree" aria-label="Repository explorer">
                  <ExplorerList folder={folders} activeId={activePane.activeTabId} open={openItem} />
                  {entities.length > 0 && (
                    <details className="workspace-tree-group" open>
                      <summary className="workspace-tree-folder">
                        <ChevronRight className="workspace-tree-arrow" size={16} strokeWidth={1.5} aria-hidden="true" />
                        <Box size={16} strokeWidth={1.5} aria-hidden="true" />
                        <span>Product records</span>
                      </summary>
                      <ul>
                        {entities.map((item) => <ExplorerItem key={item.id} item={item} active={activePane.activeTabId === item.id} open={openItem} />)}
                      </ul>
                    </details>
                  )}
                </nav>
              )}
            </div>
          </section>
        ))}
        {!compact && <ResizeHandle axis="horizontal" side={side} label={"Resize " + side + " sidebar"}
          value={dock.width} {...dockWidthBounds}
          onResize={(width) => dispatch({ type: "resize-dock", side, width })}
          onPointerResize={(event, rect) => dispatch({ type: "resize-dock", side, width: side === "left" ? event.clientX - rect.left : rect.right - event.clientX })}
        />}
      </aside>
    );
  }

  const commands = [
    ...paneCommands(activePane),
    ...workspaceTabs.map((tab) => ({ id: tab.id, label: tab.title, run: () => openItem(tab.id) })),
    ...(["explorer", "details"] as const).flatMap((module) => {
      const target = moduleSide(module) === "left" ? "right" : "left";
      return [
        { id: "toggle-" + module, label: "Toggle " + moduleLabels[module], run: () => toggleModule(module) },
        { id: "move-" + module, label: "Move " + moduleLabels[module] + " to " + target + " sidebar", run: () => moveModule(module, target) },
      ];
    }),
    ...data.items.map((item) => ({
      id: "item-" + item.id, label: item.title, detail: item.path, run: () => openItem(item.id),
    })),
  ];

  return <WorkspaceDraftProvider repositoryId={data.repositoryId} canEdit={data.canEdit}>
    <WorkspaceTasksProvider repositoryId={data.repositoryId}>
    <WorkspaceTeamNotesProvider repositoryId={data.repositoryId}>
    <WorkspaceHistoryProvider repositoryId={data.repositoryId} snapshotKey={`${data.revision}:${data.status}:${data.headRevision ?? ""}`}>
    <main className="workspace-shell" id="content" tabIndex={-1}>
      <h1 className="sr-only">{data.repositoryName} workspace</h1>
      <div className="workspace-main" ref={main} data-compact={compact} onKeyDown={(event) => {
        if (event.key === "Escape" && compact && drawer) {
          event.stopPropagation();
          closeDock(drawer);
        }
      }}>
        <nav className="workspace-ribbon" aria-label="Workspace controls">
          <span className="workspace-ribbon-item" data-tooltip="Repository settings">
            <a className="workspace-icon-button" href={data.repositoryHref} aria-label="Repository settings">
              <ArrowLeft size={16} strokeWidth={1.5} aria-hidden="true" />
            </a>
          </span>
          {(["explorer", "details"] as const).map((module) => (
            <span className="workspace-ribbon-item" data-tooltip={moduleLabels[module]} key={module}>
              <IconButton icon={module === "explorer" ? FolderTree : PanelRight} label={moduleLabels[module]}
                id={viewId("ribbon", module)} aria-pressed={dockVisible(moduleSide(module))}
                aria-controls={dockVisible(moduleSide(module)) ? viewId("dock", moduleSide(module)) : undefined}
                onClick={() => toggleModule(module)}
              />
            </span>
          ))}
          {workspaceTabs.map((tab) => (
            <span className="workspace-ribbon-item" data-tooltip={tab.title} key={tab.id}>
              <IconButton icon={tab.icon} label={tab.title} aria-pressed={activePane.activeTabId === tab.id}
                onClick={() => openItem(tab.id)} />
            </span>
          ))}
          <span className="workspace-ribbon-item" data-tooltip="Command palette">
            <IconButton icon={Search} id={viewId("ribbon", "palette")} label="Command palette" aria-keyshortcuts="Control+P Meta+P" onClick={openPalette} />
          </span>
        </nav>
        {renderDock("left")}
        <div className="workspace-center" ref={center} inert={compact && drawer !== null}>
          {renderNode(visibleLayout, size.center)}
        </div>
        {renderDock("right")}
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
      </div>
      <WorkspaceStatus item={activeItem} data={data}
        mode={activeView && activeView.itemId === activeItem?.id ? activeView.mode : undefined}
      />
      <CommandPalette dialog={palette} commands={commands} onClose={(restoreFocus) => {
        const previous = paletteTrigger.current;
        if (restoreFocus) {
          if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true });
          else focusPane();
        }
        paletteTrigger.current = null;
      }} />
    </main>
    </WorkspaceHistoryProvider>
    </WorkspaceTeamNotesProvider>
    </WorkspaceTasksProvider>
  </WorkspaceDraftProvider>;
}
