"use client";

import type { TeamNote } from "@nutshell/server/team-notes";
import { useEffect, useState } from "react";
import { WorkspaceTeamNoteEditor } from "./workspace-team-note-editor";
import { useWorkspaceTeamNotes } from "./workspace-team-notes";
import "./workspace-team-note-panel.css";

type NotesClient = ReturnType<typeof useWorkspaceTeamNotes>;

function NoteForm({ client }: { client: NotesClient }) {
  const { editor, dirty, pending, loading, change, resolveConflict, save, cancel } = client;
  if (!editor) return null;
  const { note, fields, conflict } = editor;
  const label = note ? "Edit note" : "New note";
  return <form className="workspace-note-editor" aria-label={label} onSubmit={(event) => {
    event.preventDefault();
    void save();
  }}>
    <div className="workspace-note-detail-heading">
      <h2>{label}</h2>
      <span>{dirty ? "Unsaved edits" : note ? `Version ${note.version}` : "Unsaved note"}</span>
    </div>
    {conflict && <section className="workspace-note-conflict" aria-label="Note version conflict">
      <p role="alert">This note changed after you opened it. Your attempted edits are still here.</p>
      <details open>
        <summary>Compare current saved note</summary>
        <h3>{conflict.note.title}</h3>
        <p>Version {conflict.note.version}</p>
        <WorkspaceTeamNoteEditor content={conflict.note.content} label="Current saved note body" />
      </details>
      <div className="workspace-note-actions">
        <button type="button" onClick={() => resolveConflict(true)}>Keep edits with version {conflict.note.version}</button>
        <button type="button" onClick={() => resolveConflict(false)}>Discard edits and load saved version</button>
      </div>
    </section>}
    <label>Title<input required value={fields.title} disabled={pending} onChange={(event) => change({ title: event.currentTarget.value })} /></label>
    <WorkspaceTeamNoteEditor content={fields.content} disabled={pending} onChange={(content) => change({ content })} />
    <div className="workspace-note-actions">
      <button type="submit" disabled={pending || loading || Boolean(conflict) || Boolean(note && !dirty)}>Save note</button>
      <button type="button" disabled={pending} onClick={cancel}>Cancel note edits</button>
    </div>
  </form>;
}

export function WorkspaceTeamNotePanel() {
  const client = useWorkspaceTeamNotes();
  const { data, selected, editor, loading, pending, error, status, refresh } = client;
  const [deleting, setDeleting] = useState<TeamNote | null>(null);

  useEffect(() => { void refresh(); }, [refresh]);

  const canManage = Boolean(selected && data && (data.canManage || selected.creatorId === data.viewerId));
  const confirmDelete = selected && deleting?.id === selected.id ? deleting : null;

  return <section className="workspace-notes-panel" aria-label="Team notes">
    <header className="workspace-notes-header">
      <div><h1>Team notes</h1><p>Shared in this repository workspace</p></div>
      <div className="workspace-note-actions">
        {data && <>
          <button type="button" disabled={pending || loading} onClick={() => void refresh()}>Refresh notes</button>
          <button type="button" disabled={pending} onClick={() => { setDeleting(null); client.edit(); }}>New note</button>
        </>}
      </div>
    </header>
    {(pending || status) && <p className="workspace-note-message" role="status">{pending ? "Saving note change…" : status}</p>}
    {error && <p className="workspace-note-message" role="alert">{error}</p>}
    {!data ? (
      loading || !error ? <p className="workspace-note-message" role="status">Loading team notes…</p>
        : <div className="workspace-note-message"><button type="button" onClick={() => void refresh()}>Retry notes</button></div>
    ) : <>
      {data.truncated && <p className="workspace-note-message">Showing {data.notes.length} recent notes.</p>}
      <div className="workspace-notes-main">
        <aside className="workspace-note-list">
          <ul role="list" aria-label="Repository notes">
            {data.notes.map((note) => <li key={note.id}>
              <button type="button" aria-label={note.title} aria-pressed={selected?.id === note.id}
                onClick={() => { setDeleting(null); client.select(note.id); }}>
                <span>{note.title}</span><small>Version {note.version}</small>
              </button>
            </li>)}
          </ul>
          {!data.notes.length && <p>No repository notes.</p>}
        </aside>
        {editor ? <NoteForm client={client} /> : selected && <section className="workspace-note-detail" aria-label="Selected note">
          <div className="workspace-note-detail-heading"><h2>{selected.title}</h2><span>Version {selected.version}</span></div>
          <WorkspaceTeamNoteEditor content={selected.content} label="Saved note body" />
          {canManage && <div className="workspace-note-actions">
            <button type="button" disabled={pending} onClick={() => { setDeleting(null); client.edit(selected); }}>Edit note</button>
            {!confirmDelete && <button type="button" disabled={pending} onClick={() => setDeleting(selected)}>Delete note</button>}
          </div>}
          {canManage && confirmDelete && <div className="workspace-note-conflict">
            <p>Delete this repository note?</p>
            <div className="workspace-note-actions">
              <button type="button" disabled={pending || loading} onClick={() => { setDeleting(null); void client.remove(confirmDelete); }}>Confirm delete</button>
              <button type="button" onClick={() => setDeleting(null)}>Cancel deletion</button>
            </div>
          </div>}
        </section>}
      </div>
    </>}
  </section>;
}
