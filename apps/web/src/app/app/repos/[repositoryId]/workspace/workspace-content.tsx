"use client";

import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { WorkspaceData, WorkspaceItem } from "./workspace-data";
import { documentResolver, remarkWorkspaceWikilinks } from "./workspace-markdown";

type Selection = { item: WorkspaceItem | null; items: WorkspaceItem[]; onOpen: (id: string) => void };

export function WorkspaceContent({ item, items, onOpen }: Selection) {
  const resolve = useMemo(() => documentResolver(items.filter(({ kind }) => kind === "document")), [items]);
  if (!item) return <p className="workspace-reading workspace-pane-empty">Open a document or product record from the explorer.</p>;

  if (item.kind === "entity") {
    const { entity } = item;
    return <article className="workspace-reading">
      <h1>{item.title}</h1>
      <p>{entity.summary}</p>
      <dl>
        <dt>Kind</dt><dd>{entity.kind}</dd>
        <dt>Lifecycle</dt><dd>{entity.lifecycle}</dd>
      </dl>
      {entity.code_paths.length > 0 && <><h2>Code paths</h2><ul>{entity.code_paths.map((path) => <li key={path}><code>{path}</code></li>)}</ul></>}
      {entity.memory_paths.length > 0 && <><h2>Memory</h2><ul>{entity.memory_paths.map((path) => (
        <li key={path}><button className="workspace-wikilink" onClick={() => onOpen("document:" + path)}>{path}</button></li>
      ))}</ul></>}
      {entity.relations.length > 0 && <><h2>Declared relationships</h2><ul>{entity.relations.map(({ type, target }) => (
        <li key={type + ":" + target}>{type.replaceAll("_", " ")} <button className="workspace-wikilink" onClick={() => onOpen("entity:" + target)}>
          {items.find(({ id }) => id === "entity:" + target)?.title ?? target}
        </button></li>
      ))}</ul></>}
    </article>;
  }

  return <article className="workspace-reading" aria-label={item.title}>
    {item.properties && <details className="workspace-properties"><summary>Properties</summary><pre>{item.properties}</pre></details>}
    <Markdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkWorkspaceWikilinks]}
      components={{
        a: ({ href, children }) => {
          const target = href && resolve(item.path, href);
          if (target) return <button type="button" className="workspace-wikilink" onClick={() => onOpen(target)}>{children}</button>;
          if (href && /^(?:https?:\/\/|mailto:)/iu.test(href)) return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
          return <span title="Link target unavailable in this snapshot">{children}</span>;
        },
        img: ({ alt }) => <span>{alt ? `Image unavailable. ${alt}` : "Image unavailable."}</span>,
        input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label="Checklist item" />,
      }}
    >{item.markdown}</Markdown>
  </article>;
}

const syncLabel = { current: "Indexed", stale: "Stale snapshot", invalid: "Invalid head" } as const;

export function WorkspaceDetails({ item, items, data, onOpen }: Selection & { data: WorkspaceData }) {
  const backlinks = item?.kind === "document" ? item.backlinkIds : [];
  const changes = item ? data.changes.filter((change) => item.kind === "document"
    ? change.memory_paths.includes(item.path) : change.entity_ids.includes(item.entity.id)) : [];
  return <div className="workspace-details">
    <h2>Snapshot</h2>
    <dl>
      <dt>Status</dt><dd>{syncLabel[data.status]}</dd>
      <dt>Indexed revision</dt><dd><code>{data.revision}</code></dd>
      {data.headRevision && data.headRevision !== data.revision && <>
        <dt>Current head</dt><dd><code>{data.headRevision}</code></dd>
      </>}
      {item && <><dt>Path</dt><dd><code>{item.path}</code></dd></>}
    </dl>
    {item?.kind === "document" && <>
      <h2>Backlinks</h2>
      {backlinks.length ? <ul>{backlinks.map((id) => (
        <li key={id}><button type="button" className="workspace-wikilink" onClick={() => onOpen(id)}>{items.find((item) => item.id === id)?.title}</button></li>
      ))}</ul> : <p>No indexed backlinks.</p>}
    </>}
    {changes.length > 0 && <><h2>Declared changes</h2><ul>{changes.map((change) => <li key={change.id}>{change.summary}</li>)}</ul></>}
  </div>;
}

function Stats({ item }: { item: WorkspaceItem | null }) {
  if (item?.kind !== "document") return <span>No document counters</span>;
  return <>
    <span>{item.backlinkIds.length} {item.backlinkIds.length === 1 ? "backlink" : "backlinks"}</span>
    <span>{item.words} words</span>
    <span>{item.characters} characters</span>
  </>;
}

export function WorkspaceStatus({ item, data }: { item: WorkspaceItem | null; data: WorkspaceData }) {
  return <footer className="workspace-status" aria-label="Workspace status" data-testid="workspace-status">
    <span className="workspace-status-state" title={data.revision}>{syncLabel[data.status]}</span>
    <div className="workspace-status-counters"><Stats item={item} /></div>
    <details className="workspace-status-details"><summary>Document counters</summary><div><Stats item={item} /></div></details>
  </footer>;
}
