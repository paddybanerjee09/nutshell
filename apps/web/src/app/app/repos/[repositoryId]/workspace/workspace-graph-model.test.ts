import { describe, expect, it } from "vitest";
import type { WorkspaceItem } from "./workspace-data";
import { buildWorkspaceGraph, selectWorkspaceGraph, workspaceGraphLimits } from "./workspace-graph-model";

type EntityItem = Extract<WorkspaceItem, { kind: "entity" }>;
type Entity = EntityItem["entity"];
type DocumentItem = Extract<WorkspaceItem, { kind: "document" }>;
const revision = "a".repeat(40);

function note(path: string, links: string[] = []): DocumentItem {
  return {
    kind: "document", id: `document:${path}`, title: path.split("/").at(-1)!, path,
    source: "[[Unresolved or unrelated]]", markdown: "[[Unresolved or unrelated]]", properties: "",
    linkedItemIds: links, backlinkIds: [], words: 3, characters: 27,
  };
}

function item(id: string, title: string, overrides: Partial<Entity> = {}, kindLabel?: string): EntityItem {
  return {
    id: `entity:${id}`, kind: "entity", kindLabel, path: `.nutshell/entities/${id}.json`, title,
    entity: { schema_version: 1, id, kind: "service", title, summary: `${title} description.`, lifecycle: "active",
      code_paths: [], memory_paths: [], relations: [], ...overrides },
  };
}

describe("authorized workspace graph model", () => {
  it("uses only resolved current vault links for memory graph edges", () => {
    const current = note("nutshell-vault/Current.md");
    const other = note("nutshell-vault/Other.md");
    const archived = note("nutshell-vault/archive/Old.md");
    const outside = note("README.md");
    const product = item("memory", "A product record");
    current.linkedItemIds = [other.id, other.id, archived.id, outside.id, product.id, current.id, "document:missing.md"];
    archived.linkedItemIds = [other.id];
    const graph = buildWorkspaceGraph({ revision, items: [product, archived, other, current, outside] }, "memory");
    expect(graph.revision).toBe(revision);
    expect(graph.nodes.map(({ id }) => id)).toEqual([current.id, other.id]);
    expect(graph.edges).toEqual([expect.objectContaining({ source: current.id, target: other.id, label: "note link" })]);
    expect(graph.nodes.every(({ kind }) => kind === "note")).toBe(true);
  });

  it("keeps declared product relations directed and typed, with configured labels and lifecycle", () => {
    const document = note("nutshell-vault/Feature.md");
    const feature = item("feature", "Feature", {
      kind: "feature", memory_paths: [document.path], relations: [
        { target: "service", type: "depends_on" }, { target: "service", type: "implemented_by" },
        { target: "service", type: "depends_on" }, { target: "missing", type: "part_of" },
      ],
    }, "Capabilities");
    const service = item("service", "Service", { display_group: "Operations", lifecycle: "deprecated", relations: [
      { target: "feature", type: "appears_on" }, { target: "service", type: "depends_on" },
    ] });
    const graph = buildWorkspaceGraph({ revision, items: [document, service, feature] }, "product");
    expect(graph.nodes).toEqual([
      expect.objectContaining({ id: feature.id, kind: "feature", kindLabel: "Capabilities" }),
      expect.objectContaining({ id: service.id, group: "Operations", lifecycle: "deprecated" }),
    ]);
    expect(graph.edges.map(({ source, target, label }) => [source, target, label])).toEqual([
      [feature.id, service.id, "depends_on"], [feature.id, service.id, "implemented_by"], [service.id, feature.id, "appears_on"],
      [service.id, service.id, "depends_on"],
    ]);
  });

  it("uses query terms across visible metadata and intersects kind, group, and lifecycle filters", () => {
    const audit = item("audit", "Åudit exports", { display_group: "Data", summary: "Download a completed export.", lifecycle: "planned" }, "Audit Service");
    const shared = item("shared", "Åudit console", { display_group: "Security", summary: "Download a completed export.", lifecycle: "active" });
    const screen = item("screen", "Export history", { kind: "screen", display_group: "Data", summary: "An åudit trail.", lifecycle: "planned" });
    const graph = buildWorkspaceGraph({ revision, items: [screen, shared, audit] }, "product");
    const result = selectWorkspaceGraph(graph, { query: "A\u030AudIt download", kind: "service", group: "Data", lifecycle: "planned" });
    expect(result.nodes.map(({ id }) => id)).toEqual([audit.id]);
    expect(result).toMatchObject({ totalNodes: 3, totalEdges: 0, matchedNodes: 1, truncated: false });
    expect(selectWorkspaceGraph(graph, { query: "missing" }).nodes).toEqual([]);
    expect(selectWorkspaceGraph(graph, { query: "audit service", group: "Data" }).nodes.map(({ id }) => id)).toEqual([audit.id]);
  });

  it("bounds focused neighborhoods while preserving declared edge direction", () => {
    const chain = Array.from({ length: 5 }, (_, index) => item(`item${index}`, `Item ${index}`, {
      relations: index ? [{ type: "depends_on", target: `item${index - 1}` }] : [],
    }));
    const graph = buildWorkspaceGraph({ revision, items: chain }, "product");
    const focusId = chain[0]!.id;
    const nearest = selectWorkspaceGraph(graph, { focusId });
    expect(nearest.nodes.map(({ id }) => id)).toEqual(chain.slice(0, 2).map(({ id }) => id));
    expect(nearest.edges).toEqual([expect.objectContaining({ source: chain[1]!.id, target: focusId })]);
    expect(selectWorkspaceGraph(graph, { focusId, depth: 0 }).nodes.map(({ id }) => id)).toEqual([focusId]);
    expect(selectWorkspaceGraph(graph, { focusId, depth: 100 }).nodes).toHaveLength(workspaceGraphLimits.maxDepth + 1);
    expect(selectWorkspaceGraph(graph, { focusId: "entity:unknown" }).nodes).toEqual([]);
  });

  it("keeps dense visible scopes and their reported counts deterministic and bounded", () => {
    const paths = Array.from({ length: 80 }, (_, index) => `nutshell-vault/Note-${String(index).padStart(2, "0")}.md`);
    const items = paths.map((path) => note(path, paths.map((target) => `document:${target}`)));
    const graph = buildWorkspaceGraph({ revision, items }, "memory");
    expect(buildWorkspaceGraph({ revision, items: [...items].reverse() }, "memory")).toEqual(graph);
    expect(selectWorkspaceGraph(graph).nodes).toHaveLength(workspaceGraphLimits.defaultNodes);
    const visible = selectWorkspaceGraph(graph, { limit: 1000 });
    expect(visible.nodes).toHaveLength(workspaceGraphLimits.maxNodes);
    expect(visible.edges).toHaveLength(workspaceGraphLimits.maxEdges);
    expect(visible).toMatchObject({ matchedNodes: paths.length, totalNodes: paths.length, totalEdges: paths.length * (paths.length - 1), truncated: true });
    const visibleIds = new Set(visible.nodes.map(({ id }) => id));
    expect(visible.edges.every(({ source, target }) => visibleIds.has(source) && visibleIds.has(target))).toBe(true);
    const focusId = items.at(-1)!.id;
    const belowNodeCap = selectWorkspaceGraph(graph, { focusId, limit: 20 });
    expect(belowNodeCap.truncated).toBe(true);
    expect(belowNodeCap.nodes[0]?.id).toBe(focusId);
    expect([belowNodeCap.edges[0]?.source, belowNodeCap.edges[0]?.target]).toContain(focusId);
    expect(selectWorkspaceGraph(graph, { query: "note-00" })).toMatchObject({ matchedNodes: 1, edges: [], truncated: false });
  });
});
