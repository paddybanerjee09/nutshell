import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum } from "d3-force";
import type { GraphEdge, GraphNode } from "./workspace-graph-model";

export type GraphPosition = { x: number; y: number };
type LayoutNode = GraphPosition & { id: string; fx?: number; fy?: number; vx?: number; vy?: number };

export const graphTicks = 80;
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

export function graphNeighborhood(edges: readonly GraphEdge[], focus: string | null) {
  const related = new Set<string>();
  if (!focus) return related;
  related.add(focus);
  for (const { source, target } of edges) {
    if (source === focus) related.add(target);
    if (target === focus) related.add(source);
  }
  return related;
}

export function createGraphLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  pinned: ReadonlyMap<string, GraphPosition> = new Map(),
) {
  const points: LayoutNode[] = nodes.map(({ id }, index) => {
    const pin = pinned.get(id);
    if (pin) return { id, ...pin, fx: pin.x, fy: pin.y };
    const radius = 50 * Math.sqrt(index);
    return { id, x: radius * Math.cos(index * goldenAngle), y: radius * Math.sin(index * goldenAngle) };
  });
  const lookup = new Map(points.map((node) => [node.id, node]));
  const links: SimulationLinkDatum<LayoutNode>[] = edges
    .filter(({ source, target }) => source !== target && lookup.has(source) && lookup.has(target))
    .map(({ source, target }) => ({ source, target }));
  const simulation = forceSimulation(points)
    .force("links", forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(links).id((node) => node.id).distance(120).strength(0.38))
    .force("charge", forceManyBody().strength(-210).distanceMax(450))
    .force("collision", forceCollide(42).iterations(2))
    .force("x", forceX(0).strength(0.065))
    .force("y", forceY(0).strength(0.065))
    .alphaDecay(0.055)
    .alphaMin(0.025)
    .velocityDecay(0.35)
    .stop();
  let elapsed = 0;

  return {
    get settled() { return points.length < 2 || elapsed >= graphTicks || simulation.alpha() < simulation.alphaMin(); },
    tick(count: number) {
      if (this.settled) return;
      const budget = Math.min(graphTicks - elapsed, count);
      simulation.tick(budget);
      elapsed += budget;
    },
    positions(): Map<string, GraphPosition> {
      return new Map(points.map(({ id, x, y }) => [id, { x, y }]));
    },
    pin(id: string, position: GraphPosition) {
      const point = lookup.get(id);
      if (!point) return;
      point.x = point.fx = position.x;
      point.y = point.fy = position.y;
      point.vx = point.vy = 0;
    },
  };
}
