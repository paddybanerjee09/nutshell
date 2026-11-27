"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { WorkspaceData } from "./workspace-data";
import { WorkspaceGraph } from "./workspace-graph";
import { buildWorkspaceGraph, selectWorkspaceGraph, workspaceGraphLimits } from "./workspace-graph-model";
import type { GraphMode } from "./workspace-graph-model";
import "./workspace-graph-panel.css";

export const graphTitles: Record<GraphMode, string> = { memory: "Memory Graph", product: "Product Map" };

function displayName(value: string) {
  return value.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toUpperCase());
}

export function WorkspaceGraphPanel({ data, mode, active, onOpen }: {
  data: WorkspaceData;
  mode: GraphMode;
  active: boolean;
  onOpen: (id: string) => void;
}) {
  const titleId = useId();
  const list = useRef<HTMLUListElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const [display, setDisplay] = useState<"graph" | "list">("graph");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [group, setGroup] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(workspaceGraphLimits.defaultDepth);
  const [limit, setLimit] = useState<number>(workspaceGraphLimits.defaultNodes);
  const graph = useMemo(() => buildWorkspaceGraph(data, mode), [data, mode]);
  const visible = useMemo(() => selectWorkspaceGraph(graph, {
    query, kind, group, lifecycle, focusId: focusId ?? undefined, depth, limit,
  }), [graph, query, kind, group, lifecycle, focusId, depth, limit]);
  const entries = useMemo(() => new Map(visible.nodes.map((node) => [node.id, node])), [visible.nodes]);
  const kinds = useMemo(() => [...new Map(graph.nodes.map((node) => [node.kind, node.kindLabel ?? displayName(node.kind)]))], [graph]);
  const groups = useMemo(() => [...new Set(graph.nodes.flatMap((node) => node.group ? [node.group] : []))].sort(), [graph]);
  const lifecycles = useMemo(() => [...new Set(graph.nodes.flatMap((node) => node.lifecycle ? [node.lifecycle] : []))].sort(), [graph]);
  const selected = selectedId ? entries.get(selectedId) : undefined;
  const relations = selected ? visible.edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  const listEntrance = selected?.id ?? visible.nodes[0]?.id;
  const subject = mode === "memory" ? "notes" : "product records";
  const relationship = mode === "memory" ? "note links" : "declared relationships";
  const filtered = Boolean(query.trim() || kind || group || lifecycle || focusId);

  function moveListFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = visible.nodes.length;
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : event.key === "ArrowUp" ? (index + count - 1) % count : event.key === "ArrowDown" ? (index + 1) % count : -1;
    if (next < 0) return;
    event.preventDefault();
    list.current?.querySelectorAll("button")[next]?.focus();
  }

  function clearFilters() {
    setQuery("");
    setKind("");
    setGroup("");
    setLifecycle("");
    setFocusId(null);
  }

  return (
    <section className="workspace-graph-panel" aria-labelledby={titleId}>
      <header className="workspace-graph-header">
        <h1 id={titleId}>{graphTitles[mode]}</h1>
        <p>{mode === "memory" ? "Resolved links between vault notes." : "Typed relationships declared in product records."}</p>
        <p className="workspace-graph-provenance">
          {data.repositoryName} · {data.status === "current" ? "Indexed revision" : "Last valid revision"}{" "}
          <code>{graph.revision ?? data.revision}</code>
        </p>
      </header>
      <div className="workspace-graph-controls" role="group" aria-label="Graph controls">
        <input type="search" aria-label="Search graph" placeholder={"Search " + subject} value={query} maxLength={256}
          onChange={(event) => setQuery(event.currentTarget.value)} />
        {mode === "product" && kinds.length > 0 && <select aria-label="Graph kind" value={kind} onChange={(event) => setKind(event.currentTarget.value)}>
          <option value="">All kinds</option>
          {kinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>}
        {groups.length > 0 && <select aria-label="Graph group" value={group} onChange={(event) => setGroup(event.currentTarget.value)}>
          <option value="">All groups</option>
          {groups.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>}
        {lifecycles.length > 0 && <select aria-label="Graph lifecycle" value={lifecycle}
          onChange={(event) => setLifecycle(event.currentTarget.value)}>
          <option value="">All lifecycle states</option>
          {lifecycles.map((value) => <option value={value} key={value}>{displayName(value)}</option>)}
        </select>}
        <button type="button" aria-pressed={display === "graph"} onClick={() => setDisplay("graph")}>Graph view</button>
        <button type="button" aria-pressed={display === "list"} onClick={() => setDisplay("list")} ref={listButton}>List view</button>
      </div>
      <div className="workspace-graph-scope" role="group" aria-label="Visible graph scope">
        <span>{visible.nodes.length} of {visible.totalNodes} {subject} · {visible.edges.length} of {visible.totalEdges} {relationship}</span>
        {focusId && <>
          <span>Neighborhood of {graph.nodes.find((node) => node.id === focusId)?.title ?? "selected item"}</span>
          <select aria-label="Neighborhood depth" value={depth} onChange={(event) => setDepth(Number(event.currentTarget.value))}>
            {Array.from({ length: workspaceGraphLimits.maxDepth }, (_, index) => index + 1).map((distance) =>
              <option key={distance} value={distance}>{distance} {distance === 1 ? "step" : "steps"}</option>)}
          </select>
          <button type="button" onClick={() => setFocusId(null)}>Show full graph</button>
        </>}
        {visible.matchedNodes > visible.nodes.length && <>
          <span>{visible.matchedNodes} matching {subject}</span>
          {limit < workspaceGraphLimits.maxNodes &&
            <button type="button" onClick={() => setLimit(workspaceGraphLimits.maxNodes)}>Show more nodes</button>}
        </>}
        {filtered && <button type="button" onClick={clearFilters}>Reset filters</button>}
      </div>
      {visible.nodes.length ? <div className="workspace-graph-body">
        <div className="workspace-graph-canvas" hidden={display === "list"} onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          setDisplay("list");
          listButton.current?.focus();
        }}>
          <WorkspaceGraph nodes={visible.nodes} edges={visible.edges} selectedId={selected?.id ?? null}
            onSelect={setSelectedId} active={active && display === "graph"} />
        </div>
        {display === "list" && <ul className="workspace-graph-nodes" aria-label="Graph nodes" ref={list}>
          {visible.nodes.map((node, index) => (
            <li key={node.id}>
              <button type="button" aria-label={mode === "memory" ? node.path ?? node.title : node.title}
                aria-pressed={selected?.id === node.id} tabIndex={listEntrance === node.id ? 0 : -1}
                onClick={() => setSelectedId(node.id)} onKeyDown={(event) => moveListFocus(event, index)}>
                <span>{node.title}</span>
                <small>{mode === "memory" ? node.path : node.kindLabel ?? displayName(node.kind)}</small>
              </button>
            </li>
          ))}
        </ul>}
        <aside className="workspace-graph-details" aria-label="Selected graph item">
          {selected ? <>
            <h2>{selected.title}</h2>
            {selected.summary && <p>{selected.summary}</p>}
            <dl>
              {selected.path && <><dt>Path</dt><dd><code>{selected.path}</code></dd></>}
              {mode === "product" && <><dt>Kind</dt><dd>{selected.kindLabel ?? displayName(selected.kind)}</dd></>}
              {selected.group && <><dt>Group</dt><dd>{selected.group}</dd></>}
              {selected.lifecycle && <><dt>Lifecycle</dt><dd>{displayName(selected.lifecycle)}</dd></>}
            </dl>
            <div className="workspace-graph-detail-actions">
              <button type="button" onClick={() => onOpen(selected.id)}>{mode === "memory" ? "Open note" : "Open entity"}</button>
              {selected.id !== focusId &&
                <button type="button" onClick={() => setFocusId(selected.id)}>Focus neighborhood</button>}
            </div>
            <h3>{mode === "memory" ? "Linked notes" : "Declared relationships"}</h3>
            {relations.length ? <ul className="workspace-graph-relations">
              {relations.map((edge) => {
                const outgoing = edge.source === selected.id;
                const other = entries.get(outgoing ? edge.target : edge.source);
                if (!other) return null;
                return <li key={edge.id}>
                  <code>{edge.label}</code> {outgoing ? "to" : "from"}{" "}
                  <button type="button" onClick={() => setSelectedId(other.id)}>{other.title}</button>
                </li>;
              })}
            </ul> : <p>{mode === "memory" ? "No note links in this view." : "No declared relationships in this view."}</p>}
          </> : <p>{mode === "memory" ? "Select a vault note to inspect its links." : "Select a product record to inspect its relationships."}</p>}
        </aside>
      </div> : <p className="workspace-graph-empty">{filtered
        ? "No " + subject + " match these filters."
        : "No " + subject + " are available in this indexed revision."}</p>}
    </section>
  );
}
