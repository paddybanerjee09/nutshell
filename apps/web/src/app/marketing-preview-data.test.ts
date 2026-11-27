import { describe, expect, it } from "vitest";
import { buildWorkspaceGraph, selectWorkspaceGraph } from "./app/repos/[repositoryId]/workspace/workspace-graph-model";
import { documentResolver, markdownLinks } from "./app/repos/[repositoryId]/workspace/workspace-markdown";
import { marketingPreviewData, marketingPreviewDocumentId } from "./marketing-preview-data";

describe("public marketing preview fixtures", () => {
  it("uses one bundled demo namespace and exposes no private repository aliases or paths", () => {
    expect(marketingPreviewData).toMatchObject({
      repositoryId: "demo-orbit-garden",
      repositoryName: "Orbit Garden",
      repositoryHref: "#product",
      canEdit: false,
      initialItemId: marketingPreviewDocumentId,
      changes: [],
    });
    expect(marketingPreviewData.layoutKey).toBe("nutshell.preview.orbit-garden");
    expect(marketingPreviewData.revision).toBe("demo-orbit-garden");
    expect(JSON.stringify(marketingPreviewData))
      .not.toMatch(/Field Notes|Harbor Atlas|local-coordinator|local-reader|\/app\/repos\/|\/api\/|https?:\/\//iu);
    expect(marketingPreviewData.items.every((item) => item.kind === "document" && item.path.startsWith("nutshell-vault/demo/"))).toBe(true);
  });

  it("maps Markdown links and graph selections to the same switchable sample notes", () => {
    const documents = marketingPreviewData.items.filter((item) => item.kind === "document");
    const resolve = documentResolver(documents);
    const ids = new Set(documents.map(({ id }) => id));
    const graph = buildWorkspaceGraph(marketingPreviewData, "memory");
    expect(graph.nodes.map(({ id }) => id).sort()).toEqual([...ids].sort());
    expect(documents.find(({ id }) => id === marketingPreviewDocumentId)?.title).toBe("Mission brief");

    for (const note of documents) {
      const links = markdownLinks(note.markdown);
      expect(links.length).toBeGreaterThan(0);
      const targets = links.map((href) => resolve(note.path, href));
      expect(targets.every((id) => typeof id === "string" && ids.has(id))).toBe(true);
      expect(note.linkedItemIds).toEqual(targets);
      expect(graph.edges.filter(({ source }) => source === note.id).map(({ target }) => target).sort())
        .toEqual([...note.linkedItemIds].sort());
      for (const id of targets) expect(documents.find((candidate) => candidate.id === id)?.backlinkIds).toContain(note.id);
    }

    const selection = selectWorkspaceGraph(graph, { query: "telemetry" });
    expect(selection.nodes).toHaveLength(1);
    const telemetry = documents.find(({ id }) => id === selection.nodes[0]?.id);
    expect(telemetry?.source).toContain("soil_moisture_pct");
  });
});
