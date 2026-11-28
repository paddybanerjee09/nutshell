"use client";

import { parseFrontmatter } from "@nutshell/core/frontmatter";
import { useEffect, useId, useMemo } from "react";
import { MarkdownEditor } from "./markdown-editor";
import type { WorkspaceData, WorkspaceItem } from "./workspace-data";
import { useWorkspaceDrafts } from "./workspace-drafts";
import { WorkspaceEntityHistoryLinks } from "./workspace-history";
import { documentResolver } from "./workspace-markdown";
import { WorkspaceReadMarkdown } from "./workspace-read-markdown";
import { WorkspaceDeclaredScreenshots, WorkspaceScreenshotUpload } from "./workspace-screenshot-evidence";

type Selection = { item: WorkspaceItem | null; items: WorkspaceItem[]; onOpen: (id: string) => void };
export const documentModeLabels = { read: "Read", live: "Live preview", source: "Source" } as const;
export type DocumentMode = keyof typeof documentModeLabels;

export function WorkspaceContent({ item, items, onOpen, mode: requestedMode, indexedRevision, onModeChange, onOpenHistory }: Selection & {
  mode?: DocumentMode;
  indexedRevision?: string;
  onModeChange?: (mode: DocumentMode) => void;
  onOpenHistory?: (entityId: string, changeId?: string) => void;
}) {
  const resolve = useMemo(() => documentResolver(items.filter(({ kind }) => kind === "document")), [items]);
  const drafts = useWorkspaceDrafts();
  const document = item?.kind === "document" ? item : null;
  const privatePath = document?.privateDraft ? document.path : undefined;
  const proposalPath = document?.path;
  const source = document?.source;
  const proposalEntry = drafts?.canEdit && proposalPath ? drafts.proposals.entries.get(proposalPath) : undefined;
  const proposal = proposalEntry?.proposal;
  const loadProposal = drafts?.proposals.load;
  const acceptPublication = drafts?.acceptPublication;
  const beginDraft = drafts?.begin;
  const proposalRevisionId = useId();

  useEffect(() => {
    if (proposalPath) void loadProposal?.(proposalPath, indexedRevision);
  }, [proposalPath, indexedRevision, loadProposal]);

  useEffect(() => {
    if (privatePath) void beginDraft?.(privatePath);
  }, [beginDraft, privatePath]);

  const isIndexed = Boolean(proposal?.mergeRevision && proposal.mergeRevision === indexedRevision);
  useEffect(() => {
    if (isIndexed && proposal && source !== undefined) acceptPublication?.(proposal, source);
  }, [isIndexed, proposal, source, acceptPublication]);

  if (!item) return <p className="workspace-reading workspace-pane-empty">Open a document or product record from the explorer.</p>;

  if (item.kind === "entity") {
    const { entity } = item;
    return <article className="workspace-reading" aria-label={item.title}>
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
      {onOpenHistory && <WorkspaceEntityHistoryLinks entityId={entity.id} onOpen={(changeId) => onOpenHistory(entity.id, changeId)} />}
    </article>;
  }

  const entry = drafts?.entries.get(item.path);
  const draft = entry?.kind === "editing" ? entry : null;
  const mode = requestedMode ?? (item.privateDraft ? "live" : "read");
  const showingDraft = draft && mode !== "read" ? draft : null;
  const dirty = draft !== null && draft.markdown !== draft.baseline;
  const conflict = showingDraft?.conflict;
  const stored = conflict?.draft;
  const canAcceptVersion = drafts?.canEdit && conflict?.reason === "version" && stored &&
    showingDraft && conflict.currentRevision === showingDraft.sourceRevision && stored.sourceRevision === showingDraft.sourceRevision;
  const canPropose = drafts?.canEdit && showingDraft && showingDraft.version > 0 && !dirty && !showingDraft.saving && !conflict &&
    (proposal?.draftVersion !== showingDraft.version || proposal.baseRevision !== showingDraft.sourceRevision);
  const proposalBusy = proposalEntry?.phase !== undefined && proposalEntry.phase !== "idle";
  const publication = proposalEntry?.publication;
  const retryDelivery = !isIndexed && (publication === "delivery-pending" || publication === "paused");
  const syncMessage = isIndexed ? "Change indexed"
    : publication === "invalid" ? "Indexing the merged change failed"
      : publication === "superseded" ? "The repository has moved to a different revision"
        : publication === "refreshing" ? "Refreshing the published snapshot"
          : publication === "unavailable" ? "The published snapshot is unavailable"
            : retryDelivery ? "Change indexing is pending" : "Waiting for indexing";

  const privateDocument = item.privateDraft && mode === "read" && draft ? parseFrontmatter(draft.markdown) : null;
  const readingSource = privateDocument?.ok ? privateDocument.lines.slice(privateDocument.bodyStart).join("\n")
    : privateDocument ? draft?.markdown ?? "" : item.markdown;
  const readRevision = item.privateDraft ? draft?.sourceRevision : indexedRevision;
  const reading = <article className="workspace-reading" aria-label={item.title}>
    {item.properties && <details className="workspace-properties"><summary>Properties</summary><pre>{item.properties}</pre></details>}
    <WorkspaceReadMarkdown markdown={readingSource} resolve={(href) => resolve(item.path, href)} onOpen={onOpen} />
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
        <span>{item.privateDraft ? "Private draft" : "Canonical"}</span>
        {readRevision && <code title={readRevision}>{readRevision.slice(0, 12)}</code>}
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
        {canPropose && <button type="button" aria-disabled={proposalBusy}
          onClick={() => void drafts.propose(item.path, indexedRevision)}>
          Propose change
        </button>}
      </div>
    </div>}
    {proposalEntry && (proposal || proposalEntry.error || proposalEntry.phase === "proposing") && (
      <div className="workspace-change-proposal" role="group" aria-label="Change proposal">
        <div className="workspace-proposal-summary">
          <span role="status">{proposalEntry.phase === "proposing" ? "Opening simulated PR…"
            : proposalEntry.phase === "merging" ? "Sending simulated merge…"
              : proposal?.status === "open" ? "Simulated PR open" : proposal ? "Simulated PR merged" : ""}</span>
          {proposal && <>
            <span>Draft version {proposal.draftVersion}</span>
            <span id={proposalRevisionId}>Proposal revision <code title={proposal.headRevision}>{proposal.headRevision.slice(0, 12)}</code></span>
            <code title={proposal.branch}>{proposal.branch}</code>
          </>}
          {proposal?.status === "merged" && <span role="status">{syncMessage}</span>}
          {proposal && (proposal.status === "open" || retryDelivery || (!isIndexed && publication === "refreshing")) &&
            <div className="workspace-draft-actions">
              {(proposal.status === "open" || retryDelivery) ? (
                <button type="button" aria-describedby={proposalRevisionId} aria-disabled={proposalBusy}
                  onClick={() => void drafts?.proposals.submit(item.path, { action: "merge" }, indexedRevision)}>
                  {retryDelivery ? "Retry change indexing" : "Simulate change merge"}
                </button>
              ) : <button type="button" onClick={() => drafts?.proposals.refresh()}>Refresh snapshot</button>}
            </div>}
        </div>
        {proposalEntry.error && <p role="alert">{proposalEntry.error}</p>}
        {proposalEntry.conflict?.currentRevision && <p>
          Current repository revision <code>{proposalEntry.conflict.currentRevision}</code>
        </p>}
        {proposalEntry.conflict?.draftVersion && <p>Latest saved draft version {proposalEntry.conflict.draftVersion}</p>}
        {proposalEntry.issues.length > 0 && <ul aria-label="Validation issues">
          {proposalEntry.issues.map(({ path, code, message }, index) => (
            <li key={path + ":" + code + ":" + index}><code>{path}</code> {message}</li>
          ))}
        </ul>}
      </div>
    )}
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
      {data.indexedAt && <><dt>Indexed at</dt><dd><time dateTime={data.indexedAt}>{data.indexedAt.slice(0, 19).replace("T", " ")} UTC</time></dd></>}
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
    {changes.length > 0 && <><h2>Declared changes</h2><ul>{changes.map((change) => <li key={change.id}>
      {change.summary}
      {data.provider === "fixture" ? <WorkspaceDeclaredScreenshots key={data.revision} repositoryId={data.repositoryId} change={change} />
        : change.evidence.length > 0 && <p>Screenshot evidence is unavailable in this workspace.</p>}
    </li>)}</ul></>}
    {data.canEdit && <WorkspaceScreenshotUpload repositoryId={data.repositoryId} />}
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

export function WorkspaceStatus({ item, data, mode }: {
  item: WorkspaceItem | null;
  data: WorkspaceData;
  mode?: DocumentMode;
}) {
  const drafts = useWorkspaceDrafts();
  const document = item?.kind === "document" && (item.privateDraft || (mode !== undefined && mode !== "read")) ? item : null;
  const entry = document ? drafts?.entries.get(document.path) : null;
  const text = entry?.kind === "editing" ? entry.markdown : document?.source;
  return <footer className="workspace-status" aria-label="Workspace status" data-testid="workspace-status">
    <span className="workspace-status-state" title={data.revision}>{syncLabel[data.status]}</span>
    <div className="workspace-status-counters"><Stats item={item} text={text} /></div>
    <details className="workspace-status-details"><summary>Document counters</summary><div><Stats item={item} text={text} /></div></details>
  </footer>;
}
