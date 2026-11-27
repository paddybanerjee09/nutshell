import { describe, expect, it } from "vitest";
import { createGraphLayout, graphNeighborhood, graphTicks } from "./workspace-graph-layout";

const nodes = ["alpha", "beta", "gamma", "isolated"].map((id) => Object.freeze({ id, title: id, kind: "note" }));
const edges = [
  { id: "to-beta", source: "alpha", target: "beta", label: "note link" },
  { id: "to-alpha", source: "gamma", target: "alpha", label: "note link" },
].map((edge) => Object.freeze(edge));

describe("workspace graph layout", () => {
  it("keeps only adjacent displayed nodes related in either direction", () => {
    expect(graphNeighborhood(edges, "alpha")).toEqual(new Set(["alpha", "beta", "gamma"]));
    expect(graphNeighborhood(edges, "beta")).toEqual(new Set(["beta", "alpha"]));
    expect(graphNeighborhood(edges, null)).toEqual(new Set());
  });

  it("settles deterministically within the allowed ticks without modifying graph records", () => {
    const first = createGraphLayout(nodes, edges);
    const second = createGraphLayout(nodes, edges);
    expect(first.settled).toBe(false);
    expect(first.positions()).toEqual(second.positions());
    first.tick(graphTicks);
    second.tick(graphTicks);
    const final = first.positions();
    expect(first.settled).toBe(true);
    expect(final).toEqual(second.positions());
    expect([...final.values()].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    first.tick(graphTicks);
    expect(first.positions()).toEqual(final);
    expect(edges[0]).toEqual({ id: "to-beta", source: "alpha", target: "beta", label: "note link" });
  });

  it("honors presentation pins and ignores edge endpoints outside the displayed set", () => {
    const graph = createGraphLayout(nodes, [
      ...edges, { id: "hidden", source: "alpha", target: "unavailable", label: "note link" },
      { id: "loop", source: "alpha", target: "alpha", label: "note link" },
    ], new Map([["gamma", { x: -20, y: 14 }]]));
    graph.pin("beta", { x: 90, y: 100 });
    graph.tick(graphTicks);
    expect(graph.positions().get("beta")).toEqual({ x: 90, y: 100 });
    expect(graph.positions().get("gamma")).toEqual({ x: -20, y: 14 });
    expect(graph.positions().has("unavailable")).toBe(false);
    expect(createGraphLayout([], []).settled).toBe(true);
  });
});
