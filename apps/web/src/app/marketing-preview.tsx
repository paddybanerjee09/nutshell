"use client";

import { FileText, Maximize, Network, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { MarkdownEditor } from "./app/repos/[repositoryId]/workspace/markdown-editor";
import { WorkspaceGraphPanel } from "./app/repos/[repositoryId]/workspace/workspace-graph-panel";
import { documentResolver } from "./app/repos/[repositoryId]/workspace/workspace-markdown";
import { marketingPreviewData, marketingPreviewDocumentId } from "./marketing-preview-data";
import "./marketing-preview.css";

const demoDocuments = marketingPreviewData.items.filter((item) => item.kind === "document");
const resolveDemoLink = documentResolver(demoDocuments);
const readOnlyChange = () => {};

type PreviewMode = "live" | "source";
type PreviewSurfaceProps = {
  noteId: string;
  mode: PreviewMode;
  enabled: boolean;
  onOpenNote: (id: string) => void;
  onModeChange: (mode: PreviewMode) => void;
};

function PreviewSurface({ noteId, mode, enabled, onOpenNote, onModeChange }: PreviewSurfaceProps) {
  const graphArea = useRef<HTMLDivElement>(null);
  const [graphInView, setGraphInView] = useState(false);
  const note = demoDocuments.find(({ id }) => id === noteId) ?? demoDocuments[0];

  useEffect(() => {
    const target = graphArea.current;
    if (!target) return;
    let intersecting = false;
    function update() {
      setGraphInView(intersecting && !document.hidden);
    }
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      update();
    });
    observer.observe(target);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  if (!note) return null;

  return <div className="marketing-preview-surface">
    <section className="marketing-preview-editor" aria-label="Demo editor">
      <div className="marketing-preview-pane-bar">
        <label className="marketing-preview-note-control">
          <FileText aria-hidden="true" />
          <select aria-label="Demo document" value={note.id} onChange={(event) => onOpenNote(event.currentTarget.value)}>
            {demoDocuments.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
          </select>
        </label>
        <div className="marketing-preview-modes" role="group" aria-label="Markdown view">
          <button type="button" aria-pressed={mode === "live"} onClick={() => onModeChange("live")}>Live preview</button>
          <button type="button" aria-pressed={mode === "source"} onClick={() => onModeChange("source")}>Source</button>
        </div>
      </div>
      <span className="sr-only" role="status">Viewing {note.title}</span>
      <div className="marketing-preview-editor-body">
        <MarkdownEditor key={note.id} value={note.source} mode={mode} readOnly onChange={readOnlyChange}
          onFollowLink={(href) => {
            const id = resolveDemoLink(note.path, href);
            if (!id) return false;
            onOpenNote(id);
            return true;
          }} />
      </div>
    </section>
    <div className="marketing-preview-graph" ref={graphArea}>
      <div className="marketing-preview-pane-bar marketing-preview-graph-title">
        <Network aria-hidden="true" />
        <h2>Memory Graph</h2>
      </div>
      <WorkspaceGraphPanel data={marketingPreviewData} mode="memory" active={enabled && graphInView} onOpen={onOpenNote} />
    </div>
  </div>;
}

export function MarketingPreview() {
  const [noteId, setNoteId] = useState(marketingPreviewDocumentId);
  const [mode, setMode] = useState<PreviewMode>("live");
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const titleId = useId();

  function openNote(id: string) {
    if (demoDocuments.some((note) => note.id === id)) setNoteId(id);
  }

  return <section className="marketing-preview" aria-label="Editor and graph demo">
    <div className="marketing-preview-bar">
      <div className="marketing-preview-identity"><strong>Demo</strong><span>{marketingPreviewData.repositoryName}</span></div>
      <button type="button" aria-haspopup="dialog" aria-controls={dialogId} ref={opener} onClick={() => {
        if (!dialog.current || dialog.current.open) return;
        dialog.current.showModal();
        setExpanded(true);
      }}><Maximize aria-hidden="true" />Open full demo</button>
    </div>
    <div className="marketing-preview-inline" inert={expanded}>
      <PreviewSurface noteId={noteId} mode={mode} enabled={!expanded} onOpenNote={openNote} onModeChange={setMode} />
    </div>
    <dialog className="marketing-preview-dialog" id={dialogId} aria-labelledby={titleId} ref={dialog}
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        dialog.current?.close();
      }}
      onClose={() => {
        setExpanded(false);
        opener.current?.focus();
      }}>
      <div className="marketing-preview-bar">
        <h2 id={titleId}>Full demo</h2>
        <button type="button" onClick={() => dialog.current?.close()}><X aria-hidden="true" />Close full demo</button>
      </div>
      <div className="marketing-preview-dialog-body">
        {expanded && <PreviewSurface noteId={noteId} mode={mode} enabled onOpenNote={openNote} onModeChange={setMode} />}
      </div>
    </dialog>
  </section>;
}
