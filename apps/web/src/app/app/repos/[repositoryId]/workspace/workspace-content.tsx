"use client";

import { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownEditor } from "./markdown-editor";
import type { WorkspaceData, WorkspaceItem } from "./workspace-data";
import { useWorkspaceDrafts } from "./workspace-drafts";
import { documentResolver, remarkWorkspaceWikilinks } from "./workspace-markdown";

type Selection = { item: WorkspaceItem | null; items: WorkspaceItem[]; onOpen: (id: string) => void };
export const documentModeLabels = { read: "Read", live: "Live preview", source: "Source" } as const;
export type DocumentMode = keyof typeof documentModeLabels;

export function WorkspaceContent({ item, items, onOpen, mode: requestedMode, indexedRevision, onModeChange }: Selection & {
  mode?: DocumentMode;
  indexedRevision?: string;
  onModeChange?: (mode: DocumentMode) => void;
}) {
  const resolve = useMemo(() => documentResolver(items.filter(({ kind }) => kind === "document")), [items]);
  const drafts = useWorkspaceDrafts();
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

  const entry = drafts?.entries.get(item.path);
  const draft = entry?.kind === "editing" ? entry : null;
  const mode = requestedMode ?? "read";
  const showingDraft = draft && mode !== "read" ? draft : null;
  const dirty = draft !== null && draft.markdown !== draft.baseline;
  const conflict = showingDraft?.conflict;
  const stored = conflict?.draft;
  const canAcceptVersion = drafts?.canEdit && conflict?.reason === "version" && stored &&
    showingDraft && conflict.currentRevision === showingDraft.sourceRevision && stored.sourceRevision === showingDraft.sourceRevision;

  const reading = <article className="workspace-reading" aria-label={item.title}>
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

  return <>
    {drafts && <div className="workspace-document-bar" role="group" aria-label="Document view">
      <span className="workspace-document-mode">{documentModeLabels[mode]}</span>
      {showingDraft ? <>
        <span>Private draft</span>
        {showingDraft.version > 0 && <span>Version {showingDraft.version}</span>}
        <code title={showingDraft.sourceRevision}>{showingDraft.sourceRevision.slice(0, 12)}</code>
        <span role="status">{showingDraft.saving ? "Saving draft…" : conflict ? "Draft conflict" : dirty ? "Unsaved changes"
          : showingDraft.version > 0 ? "Draft saved" : "New draft"}</span>
      </> : <>
        <span>Canonical</span>
        {indexedRevision && <code title={indexedRevision}>{indexedRevision.slice(0, 12)}</code>}
        {dirty && <span role="status">Draft has unsaved changes</span>}
      </>}
      <div className="workspace-draft-actions">
        {drafts.canEdit && !showingDraft && (
          <button type="button" aria-disabled={entry?.kind === "loading"} onClick={() => {
            void drafts.begin(item.path);
            onModeChange?.("live");
          }}>Edit draft</button>
        )}
        {drafts.canEdit && showingDraft && (
          <button type="button" aria-disabled={!dirty || showingDraft.saving || Boolean(conflict)} onClick={() => void drafts.save(item.path)}>
            Save draft
          </button>
        )}
      </div>
    </div>}
    {entry?.kind === "loading" && <p className="workspace-draft-feedback" role="status">Opening draft…</p>}
    {entry?.kind === "unavailable" && <p className="workspace-draft-feedback" role="alert">{entry.message}</p>}
    {showingDraft?.error && <p className="workspace-draft-feedback" role="alert">{showingDraft.error}</p>}
    {conflict && <div className="workspace-draft-feedback">
      <p role="alert">{conflict.reason === "source"
        ? "The repository source changed. Your draft text is still open."
        : "A newer draft version exists. Your draft text is still open."}</p>
      {conflict.currentRevision && <p>Current repository revision <code>{conflict.currentRevision}</code></p>}
      {stored && <details>
        <summary>Compare saved draft version {stored.version}</summary>
        <pre>{stored.markdown}</pre>
      </details>}
      {canAcceptVersion && <div className="workspace-draft-actions">
        <button type="button" onClick={() => drafts.acceptVersion(item.path)}>Use draft version {stored.version}</button>
      </div>}
    </div>}
    {mode === "read" ? reading : <MarkdownEditor
      key={item.path}
      value={showingDraft?.markdown ?? item.source}
      mode={mode}
      readOnly={!showingDraft || !drafts?.canEdit}
      onChange={(markdown) => drafts?.change(item.path, markdown)}
      onFollowLink={(href) => {
        const target = resolve(item.path, href);
        if (!target) return false;
        onOpen(target);
        return true;
      }}
    />}
  </>;
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

function Stats({ item, text }: { item: WorkspaceItem | null; text?: string }) {
  if (item?.kind !== "document") return <span>No document counters</span>;
  const words = text === undefined ? item.words : (text.match(/\S+/gu) ?? []).length;
  const characters = text === undefined ? item.characters : Array.from(text).length;
  return <>
    <span title="Backlinks in the indexed snapshot">{item.backlinkIds.length} {item.backlinkIds.length === 1 ? "backlink" : "backlinks"}</span>
    <span>{words} words</span>
    <span>{characters} characters</span>
  </>;
}

export function WorkspaceStatus({ item, data, mode = "read" }: {
  item: WorkspaceItem | null;
  data: WorkspaceData;
  mode?: DocumentMode;
}) {
  const drafts = useWorkspaceDrafts();
  const document = mode !== "read" && item?.kind === "document" ? item : null;
  const entry = document ? drafts?.entries.get(document.path) : null;
  const text = entry?.kind === "editing" ? entry.markdown : document?.source;
  return <footer className="workspace-status" aria-label="Workspace status" data-testid="workspace-status">
    <span className="workspace-status-state" title={data.revision}>{syncLabel[data.status]}</span>
    <div className="workspace-status-counters"><Stats item={item} text={text} /></div>
    <details className="workspace-status-details"><summary>Document counters</summary><div><Stats item={item} text={text} /></div></details>
  </footer>;
}
