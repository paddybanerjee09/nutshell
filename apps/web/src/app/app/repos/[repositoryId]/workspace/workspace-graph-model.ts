import type { WorkspaceItem } from "./workspace-data";

export type GraphMode = "memory" | "product";
export type GraphNode = {
  id: string;
  title: string;
  kind: string;
  kindLabel?: string;
  summary?: string;
  group?: string;
  path?: string;
  lifecycle?: string;
};
export type GraphEdge = { id: string; source: string; target: string; label: string };
export type WorkspaceGraph = { mode: GraphMode; revision: string | null; nodes: GraphNode[]; edges: GraphEdge[] };
export type WorkspaceGraphFilters = {
  query?: string;
  kind?: string;
  group?: string;
  lifecycle?: string;
  focusId?: string;
  depth?: number;
  limit?: number;
};
export type WorkspaceGraphView = WorkspaceGraph & {
  totalNodes: number;
  totalEdges: number;
  matchedNodes: number;
  truncated: boolean;
};
type GraphInput = { revision: string | null; items: readonly WorkspaceItem[] };
type WorkspaceDocument = Extract<WorkspaceItem, { kind: "document" }>;

export const workspaceGraphLimits = { defaultNodes: 36, maxNodes: 64, maxEdges: 192, defaultDepth: 1, maxDepth: 3 } as const;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function nodeOrder(left: GraphNode, right: GraphNode) {
  return compareText(normalized(left.title), normalized(right.title)) || compareText(left.id, right.id);
}

export function buildWorkspaceGraph(data: GraphInput, mode: GraphMode): WorkspaceGraph {
  const nodes: GraphNode[] = [];
  const edges = new Map<string, GraphEdge>();
  function addEdge(source: string, target: string, label: string) {
    const id = JSON.stringify([mode, source, target, label]);
    if (!edges.has(id)) edges.set(id, { id, source, target, label });
  }

  if (mode === "memory") {
    // Workspace document IDs already carry the shared resolver's exact results from the authorized snapshot.
    const notes = data.items.filter((item): item is WorkspaceDocument => item.kind === "document" && item.path.startsWith("nutshell-vault/") &&
      !item.path.startsWith("nutshell-vault/archive/"));
    const available = new Set(notes.map((note) => note.id));
    for (const note of notes) {
      nodes.push({ id: note.id, title: note.title, kind: "note", kindLabel: "Note", path: note.path });
      for (const target of note.linkedItemIds) {
        if (target !== note.id && available.has(target)) addEdge(note.id, target, "note link");
      }
    }
  } else {
    const entities = data.items.filter((item) => item.kind === "entity");
    const available = new Map(entities.map((item) => [item.entity.id, item.id]));
    for (const item of entities) {
      const { entity } = item;
      nodes.push({ id: item.id, title: item.title, kind: entity.kind, kindLabel: item.kindLabel ?? entity.kind,
        summary: entity.summary, group: entity.display_group, path: item.path, lifecycle: entity.lifecycle });
      for (const { target, type } of entity.relations) {
        const targetId = available.get(target);
        if (targetId !== undefined) addEdge(item.id, targetId, type);
      }
    }
  }

  return { mode, revision: data.revision, nodes: nodes.sort(nodeOrder), edges: [...edges.values()].sort((left, right) => compareText(left.id, right.id)) };
}

function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.trunc(value)));
}

function neighborhood(graph: WorkspaceGraph, focusId: string, depth: number) {
  const distances = new Map<string, number>();
  if (!graph.nodes.some(({ id }) => id === focusId)) return distances;
  distances.set(focusId, 0);
  if (depth === 0) return distances;

  const adjacent = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    if (!adjacent.has(source)) adjacent.set(source, []);
    if (!adjacent.has(target)) adjacent.set(target, []);
    adjacent.get(source)!.push(target);
    adjacent.get(target)!.push(source);
  }

  const pending = [focusId];
  for (const id of pending) {
    const distance = distances.get(id)!;
    if (distance >= depth) break;
    for (const next of adjacent.get(id) ?? []) {
      if (distances.has(next)) continue;
      distances.set(next, distance + 1);
      pending.push(next);
    }
  }
  return distances;
}

export function selectWorkspaceGraph(graph: WorkspaceGraph, filters: WorkspaceGraphFilters = {}): WorkspaceGraphView {
  const { defaultNodes, maxNodes, maxEdges, defaultDepth, maxDepth } = workspaceGraphLimits;
  const limit = bounded(filters.limit, defaultNodes, 1, maxNodes);
  const query = normalized((filters.query ?? "").trim().slice(0, 256));
  const terms = query.split(/\s+/u).filter(Boolean);
  const focus = filters.focusId;
  const nearby = focus ? neighborhood(graph, focus, bounded(filters.depth, defaultDepth, 0, maxDepth)) : null;

  const matches: { node: GraphNode; score: number; distance: number }[] = [];
  for (const node of graph.nodes) {
    if ((nearby && !nearby.has(node.id)) || (filters.kind && filters.kind !== node.kind) ||
        (filters.group && filters.group !== node.group) || (filters.lifecycle && filters.lifecycle !== node.lifecycle)) continue;
    const title = normalized(node.title);
    const searchable = normalized([node.title, node.kind, node.kindLabel, node.summary, node.group, node.path, node.lifecycle].join("\n"));
    if (!terms.every((term) => searchable.includes(term))) continue;
    const score = query && title === query ? 1 + terms.length : terms.filter((term) => title.includes(term)).length;
    matches.push({ node, score, distance: nearby?.get(node.id) ?? 0 });
  }
  matches.sort((left, right) => left.distance - right.distance || right.score - left.score || nodeOrder(left.node, right.node));
  const nodes = matches.slice(0, limit).map(({ node }) => node);
  const visible = new Set(nodes.map(({ id }) => id));
  const adjacentEdges: GraphEdge[] = [];
  const peerEdges: GraphEdge[] = [];
  let matchedEdges = 0;
  for (const edge of graph.edges) {
    if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
    matchedEdges++;
    const selected = focus && (edge.source === focus || edge.target === focus) ? adjacentEdges : peerEdges;
    if (selected.length < maxEdges) selected.push(edge);
  }
  const edges = [...adjacentEdges, ...peerEdges].slice(0, maxEdges);
  const truncated = matches.length > nodes.length || matchedEdges > edges.length;
  return { mode: graph.mode, revision: graph.revision, nodes, edges,
    totalNodes: graph.nodes.length, totalEdges: graph.edges.length, matchedNodes: matches.length, truncated };
}
