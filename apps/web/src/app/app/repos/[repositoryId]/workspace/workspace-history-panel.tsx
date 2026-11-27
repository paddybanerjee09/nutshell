"use client";

import { parseFrontmatter } from "@nutshell/core/frontmatter";
import type { FixtureProductHistory } from "@nutshell/server/fixture-history";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceData } from "./workspace-data";
import { historyEndpoint, useWorkspaceHistory } from "./workspace-history";
import { documentResolver } from "./workspace-markdown";
import { WorkspaceReadMarkdown } from "./workspace-read-markdown";
import { WorkspaceDeclaredScreenshots } from "./workspace-screenshot-evidence";
import "./workspace-history-panel.css";

type Entry = FixtureProductHistory["entries"][number];
type CurrentEntity = Extract<WorkspaceData["items"][number], { kind: "entity" }>;
type OriginalNote = { path: string; markdown: string; sourceRevision: string };
export type HistoryFocus = { entityId?: string; changeId?: string; path?: string };

const impactText = { user_visible: "User-visible", internal: "Internal", none: "No declared product impact" } as const;
const snapshotText = { current: "Current indexed snapshot", stale: "Last valid snapshot", invalid: "Last valid snapshot · invalid current head" } as const;

function kindTitle(kind: string) {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replaceAll("_", " ");
}

function groupEvents(entries: Entry[], current: ReadonlyMap<string, CurrentEntity>,
  group: "entity" | "kind", entityId: string) {
  const groups = new Map<string, { label: string; entries: Entry[] }>();
  for (const entry of entries) {
    const entities = entityId ? entry.entities.filter(({ id }) => id === entityId) : entry.entities;
    const labels = new Map(entities.map(({ id, title, kind }): [string, string] => {
      const entity = current.get(id);
      const kindLabel = (entity?.entity.kind === kind ? entity.kindLabel : undefined) ?? kindTitle(kind);
      return group === "entity" ? [id, entity?.title ?? title] : [kind, kindLabel];
    }));
    if (labels.size === 0) labels.set("", "Other changes");
    for (const [key, label] of labels) {
      const existing = groups.get(key);
      if (existing) existing.entries.push(entry);
      else groups.set(key, { label, entries: [entry] });
    }
  }
  return groups;
}

function OriginalNoteView({ repositoryId, changeId, sourceRevision, relatedPaths, path, onOpen, onClose }: {
  repositoryId: string;
  changeId: string;
  sourceRevision?: string;
  relatedPaths?: string[];
  path: string;
  onOpen: (path: string) => void;
  onClose: () => void;
}) {
  const [result, setResult] = useState<OriginalNote | "unavailable" | null>(null);
  const endpoint = historyEndpoint(repositoryId) + "/" + encodeURIComponent(changeId) + "?" + new URLSearchParams({ path });
  const noteLink = `/app/repos/${encodeURIComponent(repositoryId)}/workspace?` + new URLSearchParams({ history: changeId, note: path });
  const resolve = useMemo(() => documentResolver(relatedPaths?.map((path) => ({ path, id: path })) ?? []), [relatedPaths]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        const note = response.ok ? await response.json() as OriginalNote : null;
        if (!controller.signal.aborted) setResult(note?.path === path && (!sourceRevision || note.sourceRevision === sourceRevision) ? note : "unavailable");
      } catch {
        if (!controller.signal.aborted) setResult("unavailable");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, sourceRevision, path]);

  const note = result !== "unavailable" ? result : null;
  const revision = note?.sourceRevision ?? sourceRevision;
  const parsed = note ? parseFrontmatter(note.markdown) : null;
  const body = note ? (parsed?.ok ? parsed.lines.slice(parsed.bodyStart).join("\n") : note.markdown) : null;
  return <section className="workspace-history-original" aria-label="Original note">
    <header><h3>Original note</h3><button type="button" onClick={onClose}>Close original note</button></header>
    <p><code>{path}</code></p>
    {revision && <p>Source revision <code>{revision}</code></p>}
    {result === null && <p role="status">Loading original note…</p>}
    {result === "unavailable" && <p role="status">Original note unavailable</p>}
    {body !== null && <p><a href={noteLink} target="_blank" rel="noopener noreferrer">Link to original note</a></p>}
    {body !== null && <article className="workspace-reading">
      {parsed?.ok && parsed.bodyStart > 2 && <details className="workspace-properties">
        <summary>Properties</summary><pre>{parsed.lines.slice(1, parsed.bodyStart - 1).join("\n")}</pre>
      </details>}
      <WorkspaceReadMarkdown markdown={body} resolve={(href) => resolve(path, href)} onOpen={onOpen} unavailable="Link target unavailable in this event" />
    </article>}
  </section>;
}

function ChangeDetails({ entry, entries, current, repositoryId, onSelect, onOpenEntity, path, setPath }: {
  entry: Entry;
  entries: Entry[];
  current: ReadonlyMap<string, CurrentEntity>;
  repositoryId: string;
  onSelect: (id: string) => void;
  onOpenEntity: (id: string) => void;
  path: string | null;
  setPath: (path: string | null) => void;
}) {
  const { change } = entry;
  const relations = [
    { action: "Reverses", id: change.reverses_change_id }, { action: "Corrects", id: change.corrects_change_id },
    ...entries.flatMap((related) => {
      if (related.change.reverses_change_id === entry.id) return [{ action: "Reversed by", id: related.id }];
      if (related.change.corrects_change_id === entry.id) return [{ action: "Corrected by", id: related.id }];
      return [];
    }),
  ].filter((relation): relation is { action: string; id: string } => Boolean(relation.id));

  return <section className="workspace-history-change" aria-label="Selected change">
    <h2>{change.summary}</h2>
    <div className="workspace-history-provenance">
      <span>Fixture observation</span><span>Deployment unknown</span>
      {entry.observation === "baseline" && <span>Previously indexed baseline</span>}
    </div>
    <dl className="workspace-history-facts">
      <dt>Source revision</dt><dd><code>{entry.sourceRevision}</code></dd>
      <dt>Observed at</dt><dd><time dateTime={entry.observedAt}>{entry.observedAt}</time></dd>
      <dt>Change type</dt><dd>{kindTitle(change.change_type)}</dd>
      <dt>Declared impact</dt><dd>{impactText[change.product_impact]}</dd>
    </dl>
    {entry.entities.length > 0 && <section aria-label="Affected entities">
      <h3>Affected entities</h3>
      <ul>{entry.entities.map(({ id, title, kind }) => {
        const entity = current.get(id);
        return <li key={id}>
          {entity ? <button type="button" className="workspace-wikilink" onClick={() => onOpenEntity(id)}>{entity.title}</button> : <span>{title}</span>}
          <dl className="workspace-history-facts">
            <dt>Entity ID</dt><dd><code>{id}</code></dd>
            <dt>Original title</dt><dd>{title}</dd>
            <dt>Original kind</dt><dd>{kindTitle(kind)}</dd>
            <dt>Current title</dt><dd>{entity?.title ?? "Absent from the indexed snapshot"}</dd>
            {entity && <><dt>Current lifecycle</dt><dd>{kindTitle(entity.entity.lifecycle)}</dd></>}
          </dl>
        </li>;
      })}</ul>
    </section>}
    <details className="workspace-history-rationale">
      <summary>Technical rationale</summary>
      <dl className="workspace-history-facts">
        <dt>Declared rationale</dt><dd>{change.rationale}</dd>
        <dt>Technical summary</dt><dd>{change.technical_summary}</dd>
      </dl>
    </details>
    {relations.length > 0 && <section aria-label="Related changes">
      <h3>Related changes</h3>
      <ul>{relations.map(({ id, action }) => {
        const related = entries.find((candidate) => candidate.id === id);
        return <li key={action + id}>{related
          ? <button type="button" className="workspace-wikilink" onClick={() => onSelect(id)}>{action} {related.change.summary}</button>
          : <>{action} <code>{id}</code> <span>Change unavailable in this view</span></>}</li>;
      })}</ul>
    </section>}
    {change.memory_paths.length > 0 && <section aria-label="Original memory references">
      <h3>Original memory references</h3>
      <ul>{change.memory_paths.map((note) => <li key={note}>
        <button type="button" className="workspace-wikilink" onClick={() => setPath(note)}>{note}</button>
      </li>)}</ul>
      {path && change.memory_paths.includes(path) && <OriginalNoteView key={entry.id + "\0" + path} repositoryId={repositoryId}
        changeId={entry.id} sourceRevision={entry.sourceRevision} relatedPaths={change.memory_paths} path={path}
        onOpen={setPath} onClose={() => setPath(null)} />}
    </section>}
    {path && !change.memory_paths.includes(path) && <p role="status">Original note unavailable</p>}
    <WorkspaceDeclaredScreenshots repositoryId={repositoryId} change={change} />
  </section>;
}

export function WorkspaceHistoryPanel({ data, focus, onOpenEntity }: { data: WorkspaceData; focus?: HistoryFocus; onOpenEntity: (id: string) => void }) {
  const history = useWorkspaceHistory();
  const resource = history?.resource;
  const [group, setGroup] = useState<"entity" | "kind">("entity");
  const [entityId, setEntityId] = useState(focus?.entityId ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(focus?.changeId ?? null);
  const [path, setPath] = useState<string | null>(focus?.path ?? null);

  const current = useMemo(() => new Map(data.items.flatMap((item) => item.kind === "entity" ? [[item.entity.id, item] as const] : [])), [data.items]);
  const entries = resource?.state === "ready" ? resource.data.entries : [];
  const entities = new Map<string, string>();
  for (const entry of entries) {
    for (const entity of entry.entities) if (!entities.has(entity.id)) entities.set(entity.id, current.get(entity.id)?.title ?? entity.title);
  }
  if (entityId && !entities.has(entityId)) entities.set(entityId, current.get(entityId)?.title ?? entityId);
  const filtered = entityId ? entries.filter((entry) => entry.change.entity_ids.includes(entityId)) : entries;
  const selected = selectedId ? entries.find((entry) => entry.id === selectedId) ?? null : filtered[0] ?? null;
  const groups = groupEvents(filtered, current, group, entityId);

  function select(id: string) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (entityId && entry && !entry.change.entity_ids.includes(entityId)) setEntityId("");
    setSelectedId(id);
    setPath(null);
  }

  return <section className="workspace-history-panel" aria-label="Product history">
    <header className="workspace-history-header">
      <h1>History</h1><p>{snapshotText[data.status]} <code>{data.revision}</code></p>
    </header>
    {(!resource || resource.state === "loading") && <p className="workspace-history-message" role="status">Loading product history…</p>}
    {resource?.state === "unavailable" && <div className="workspace-history-message">
      <p role="status">Product history unavailable</p><button type="button" onClick={() => void history?.load(true)}>Retry history</button>
    </div>}
    {resource?.state === "ready" && <>
      <div className="workspace-history-filters" role="group" aria-label="History filters">
        <select aria-label="Group history by" value={group} onChange={(event) => setGroup(event.currentTarget.value === "kind" ? "kind" : "entity")}>
          <option value="entity">Group by entity</option><option value="kind">Group by kind</option>
        </select>
        <select aria-label="History entity" value={entityId} onChange={(event) => { setEntityId(event.currentTarget.value); setSelectedId(null); setPath(null); }}>
          <option value="">All entities</option>{Array.from(entities, ([id, title]) => <option key={id} value={id}>{title}</option>)}
        </select>
        {resource.data.truncated && <span>Showing the latest {entries.length} events</span>}
      </div>
      <div className="workspace-history-main">
        <nav className="workspace-history-list" aria-label="History events">
          {Array.from(groups, ([id, { label, entries }]) => <div key={id}>
            <h2>{label}</h2>
            <ul>{entries.map((entry) => <li key={entry.id}>
              <button type="button" aria-label={entry.change.summary} aria-pressed={entry.id === selected?.id} onClick={() => select(entry.id)}>
                <span>{entry.change.summary}</span><small>{kindTitle(entry.change.change_type)} · <time dateTime={entry.observedAt}>{entry.observedAt.slice(0, 10)}</time></small>
              </button>
            </li>)}</ul>
          </div>)}
          {groups.size === 0 && <p>No indexed changes {entityId ? "for this entity" : "in this repository"}.</p>}
        </nav>
        {selected ? <ChangeDetails key={selected.id} entry={selected} entries={entries} current={current} repositoryId={data.repositoryId}
          onSelect={select} onOpenEntity={onOpenEntity} path={path} setPath={setPath} />
          : selectedId && path && focus?.changeId === selectedId && focus.path === path
            ? <OriginalNoteView key={selectedId + "\0" + path} repositoryId={data.repositoryId} changeId={selectedId}
              path={path} onOpen={setPath} onClose={() => setPath(null)} />
            : selectedId && <p className="workspace-history-message" role="status">Change unavailable in this view</p>}
      </div>
    </>}
  </section>;
}
