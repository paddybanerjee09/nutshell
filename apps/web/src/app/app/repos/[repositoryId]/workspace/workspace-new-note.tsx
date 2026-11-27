"use client";

import { useId, useState, type FormEvent } from "react";
import { useWorkspaceDrafts } from "./workspace-drafts";

export function WorkspaceNewNote({ revision, onCreated }: { revision: string; onCreated: (path: string) => void }) {
  const drafts = useWorkspaceDrafts();
  const pathHint = useId();
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("notes/");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !drafts?.canEdit) return;
    const relativePath = path.trim().replace(/^nutshell-vault\//u, "");
    const fullPath = "nutshell-vault/" + relativePath;
    setSaving(true);
    setError("");
    const failure = await drafts.create({ title: title.trim(), path: fullPath, sourceRevision: revision });
    setSaving(false);
    if (failure) setError(failure);
    else onCreated(fullPath);
  }

  return <form className="workspace-reading workspace-new-note" aria-label="New Markdown note" onSubmit={(event) => void submit(event)}>
    <h1>New Markdown note</h1>
    <label>Title<input value={title} onChange={(event) => setTitle(event.currentTarget.value)} maxLength={160} required /></label>
    <label>Vault path<input value={path} onChange={(event) => setPath(event.currentTarget.value)}
      aria-describedby={pathHint} maxLength={497} required /></label>
    <p id={pathHint}>Use a .md path inside <code>nutshell-vault/</code>.</p>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-draft-actions">
      <button type="submit" disabled={saving}>{saving ? "Creating private draft…" : "Create private draft"}</button>
    </div>
  </form>;
}
