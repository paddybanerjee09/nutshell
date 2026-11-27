"use client";

import { Handle, Position, ReactFlow, getStraightPath, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { Crosshair, Maximize, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "./pane-controls";
import { createGraphLayout, graphNeighborhood, graphTicks, type GraphPosition } from "./workspace-graph-layout";
import type { GraphEdge, GraphNode } from "./workspace-graph-model";
import "@xyflow/react/dist/style.css";
import "./workspace-graph.css";

type WorkspaceGraphProps = {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  active?: boolean;
};

type CircleData = {
  title: string;
  selected: boolean;
  highlighted: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onBlur: () => void;
};
type FlowNode = Node<CircleData, "circle">;
type FlowEdge = Edge<Record<string, unknown>, "connection">;
type Layout = ReturnType<typeof createGraphLayout>;

const nodeOrigin: [number, number] = [0.5, 0.5];
const fitOptions = { padding: 0.24, minZoom: 0.3, maxZoom: 1.15 };
const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function reducedMotion() { return window.matchMedia(motionQuery).matches; }
function serverMotion() { return false; }

function CircleNode({ id, data }: NodeProps<FlowNode>) {
  return <div className="workspace-graph-dot">
    <Handle type="source" position={Position.Right} isConnectable={false} />
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <button type="button" className="workspace-graph-node" title={data.title} aria-label={data.title}
      aria-pressed={data.selected} data-testid="workspace-graph-node" data-node-id={id}
      data-dimmed={data.dimmed} data-highlighted={data.highlighted}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) data.onFocus(); }} onBlur={data.onBlur}
      onClick={(event) => {
        if (event.detail !== 0) return;
        event.stopPropagation();
        data.onSelect();
      }}>
      <span className="workspace-graph-node-label">{data.title}</span>
    </button>
  </div>;
}

function GraphConnection({ id, source, target, sourceX, sourceY, targetX, targetY }: EdgeProps<FlowEdge>) {
  const [straight] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const line = source === target
    ? `M ${sourceX - 10} ${sourceY - 10} C ${sourceX - 44} ${sourceY - 54}, ${sourceX + 44} ${sourceY - 54}, ${sourceX + 10} ${sourceY - 10}`
    : straight;
  return <path id={id} d={line} className="react-flow__edge-path workspace-graph-edge" fill="none"
    vectorEffect="non-scaling-stroke" data-testid="workspace-graph-edge" />;
}

const nodeTypes = { circle: CircleNode };
const edgeTypes = { connection: GraphConnection };

export function WorkspaceGraph({ nodes, edges, selectedId, onSelect, active = true }: WorkspaceGraphProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvasSize = useRef<{ width: number; height: number } | null>(null);
  const pins = useRef(new Map<string, GraphPosition>());
  const framed = useRef(new WeakSet<Layout>());
  const dragged = useRef(false);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);
  const [paused, setPaused] = useState(false);
  const [reset, setReset] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const [frame, setFrame] = useState<{ layout: Layout; positions: Map<string, GraphPosition> } | null>(null);
  const layout = useMemo(() => createGraphLayout(nodes, edges, pins.current), [nodes, edges, reset]);
  const positions = frame?.layout === layout ? frame.positions : layout.positions();
  const cameraDuration = reduced ? 0 : 180;
  const ids = useMemo(() => new Set(nodes.map(({ id }) => id)), [nodes]);
  const highlight = [focused, hovered, selectedId].find((id): id is string => id !== null && ids.has(id)) ?? null;
  const related = useMemo(() => graphNeighborhood(edges, highlight), [edges, highlight]);
  const phase = !active ? "inactive" : reduced ? "reduced-motion" : paused ? "paused" : layout.settled ? "settled" : "running";

  useEffect(() => {
    if (!active || paused || layout.settled) return;
    if (reduced) {
      layout.tick(graphTicks);
      setFrame({ layout, positions: layout.positions() });
      return;
    }
    let frameId: number;
    function step() {
      layout.tick(2);
      setFrame({ layout, positions: layout.positions() });
      if (!layout.settled) frameId = requestAnimationFrame(step);
    }
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [active, layout, paused, reduced]);

  useEffect(() => {
    if (!active || !flow || (!layout.settled && !paused) || framed.current.has(layout)) return;
    const frameId = requestAnimationFrame(() => {
      if (framed.current.has(layout)) return;
      framed.current.add(layout);
      void flow.fitView({ ...fitOptions, duration: cameraDuration });
    });
    return () => cancelAnimationFrame(frameId);
  }, [active, flow, layout, phase, paused, cameraDuration]);

  useEffect(() => {
    const canvas = root.current;
    if (!active || !flow || !canvas) return;
    let frameId: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frameId !== undefined) return;
      // Let React Flow's own measurement catch up before fitting the viewport.
      frameId = requestAnimationFrame(() => {
        frameId = undefined;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (!width || !height) return;
        const previous = canvasSize.current;
        canvasSize.current = { width, height };
        if (!previous || (previous.width === width && previous.height === height)) return;
        if (layout.settled) framed.current.add(layout);
        void flow.fitView({ ...fitOptions, duration: cameraDuration });
      });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (frameId !== undefined) cancelAnimationFrame(frameId);
    };
  }, [active, flow, layout, cameraDuration]);

  function centerNode(id: string, onlyIfOutOfView = false) {
    const position = positions.get(id);
    if (!flow || !position || !root.current) return;
    const { x, y, zoom } = flow.getViewport();
    const screenX = x + zoom * position.x;
    const screenY = y + zoom * position.y;
    if (onlyIfOutOfView && screenX >= 18 && screenX <= root.current.clientWidth - 18 &&
        screenY >= 18 && screenY <= root.current.clientHeight - 50) return;
    framed.current.add(layout);
    void flow.setCenter(position.x, position.y, { zoom, duration: cameraDuration });
  }

  function updatePin(id: string, position: GraphPosition) {
    framed.current.add(layout);
    pins.current.set(id, position);
    layout.pin(id, position);
    setFrame({ layout, positions: layout.positions() });
  }

  const graphNodes: FlowNode[] = nodes.map(({ id, title }) => ({
    id, type: "circle", position: positions.get(id)!, width: 32, height: 32,
    selectable: false, connectable: false, deletable: false,
    data: {
      title, selected: id === selectedId, highlighted: id === highlight,
      dimmed: highlight !== null && !related.has(id),
      onSelect: () => onSelect(id),
      onFocus: () => { setFocused(id); centerNode(id, true); },
      onBlur: () => setFocused((idFocused) => idFocused === id ? null : idFocused),
    },
  }));
  const graphEdges: FlowEdge[] = edges.filter(({ source, target }) => ids.has(source) && ids.has(target)).map((edge) => ({
    id: edge.id, source: edge.source, target: edge.target, type: "connection", selectable: false, deletable: false,
    ariaLabel: edge.label,
  }));

  function zoom(direction: "in" | "out") {
    framed.current.add(layout);
    if (direction === "in") void flow?.zoomIn({ duration: cameraDuration });
    else void flow?.zoomOut({ duration: cameraDuration });
  }

  function fit() {
    framed.current.add(layout);
    void flow?.fitView({ ...fitOptions, duration: cameraDuration });
  }

  return <div className="workspace-graph-view" ref={root} role="region" aria-label="Graph canvas" onPointerDownCapture={() => { dragged.current = false; }}
    data-testid="workspace-graph-canvas" data-layout={phase} data-motion={reduced ? "reduced" : "standard"}>
    <ReactFlow<FlowNode, FlowEdge>
      nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodeOrigin={nodeOrigin}
      onInit={setFlow} fitView fitViewOptions={fitOptions} minZoom={0.25} maxZoom={3}
      nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
      zoomOnScroll={false} zoomOnDoubleClick={false} zoomOnPinch panOnDrag preventScrolling={false}
      selectionKeyCode={null} deleteKeyCode={null} multiSelectionKeyCode={null}
      panActivationKeyCode={null} zoomActivationKeyCode={null} nodeDragThreshold={4}
      proOptions={{ hideAttribution: true }}
      onMoveStart={(event) => { if (event) framed.current.add(layout); }}
      onNodeMouseEnter={(_event, node) => setHovered(node.id)} onNodeMouseLeave={(_event, node) => setHovered((id) => id === node.id ? null : id)}
      onNodeClick={(_event, node) => { if (!dragged.current) onSelect(node.id); }}
      onNodeDrag={(_event, node) => { dragged.current = true; updatePin(node.id, node.position); }}
      onNodeDragStop={(_event, node) => { if (dragged.current) updatePin(node.id, node.position); }}
    />
    <div className="workspace-graph-actions" aria-label="Graph controls" role="group">
      <IconButton icon={Plus} label="Zoom in" disabled={!flow} onClick={() => zoom("in")} />
      <IconButton icon={Minus} label="Zoom out" disabled={!flow} onClick={() => zoom("out")} />
      <IconButton icon={Maximize} label="Fit graph" disabled={!flow} onClick={fit} />
      <IconButton icon={Crosshair} label="Center selected node" disabled={!flow || !selectedId || !ids.has(selectedId)}
        onClick={() => { if (selectedId) centerNode(selectedId); }} />
      <IconButton icon={RotateCcw} label="Reset graph" disabled={!flow} onClick={() => { pins.current.clear(); setReset((count) => count + 1); }} />
      <IconButton icon={paused ? Play : Pause} label={paused ? "Resume layout" : "Pause layout"} disabled={reduced}
        aria-pressed={paused} onClick={() => setPaused((value) => !value)} />
    </div>
  </div>;
}
