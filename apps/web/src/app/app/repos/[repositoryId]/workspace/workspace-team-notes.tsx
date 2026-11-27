"use client";

import { emptyTeamNoteContent, type TeamNoteContent } from "@nutshell/core/team-note-content";
import type { CreateTeamNoteInput, TeamNote, TeamNoteConflict, TeamNoteList, UpdateTeamNoteInput } from "@nutshell/server/team-notes";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type NoteFields = { title: string; content: TeamNoteContent };
type NoteEditor = { note: TeamNote | null; fields: NoteFields; conflict: TeamNoteConflict | null };
type NoteClient = {
  data: TeamNoteList | null;
  selected: TeamNote | null;
  editor: NoteEditor | null;
  loading: boolean;
  pending: boolean;
  dirty: boolean;
  error: string;
  status: string;
  refresh: () => Promise<void>;
  select: (id: string) => void;
  edit: (note?: TeamNote) => void;
  change: (fields: Partial<NoteFields>) => void;
  resolveConflict: (keep: boolean) => void;
  cancel: () => void;
  save: () => Promise<void>;
  remove: (note: TeamNote) => Promise<void>;
};

const NoteContext = createContext<NoteClient | null>(null);

export function useWorkspaceTeamNotes() {
  const value = useContext(NoteContext);
  if (!value) throw new Error("Team notes require their workspace state.");
  return value;
}

function noteFields(note?: TeamNote | null): NoteFields {
  return note ? { title: note.title, content: note.content } : { title: "", content: emptyTeamNoteContent };
}

function serializeContent(content: TeamNoteContent) {
  return JSON.stringify(content, (_key, value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const fields = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(fields).sort().map((key) => [key, fields[key]]));
  });
}

function noteChanges(editor: NoteEditor): Partial<NoteFields> {
  const baseline = noteFields(editor.note);
  const { title, content } = editor.fields;
  return {
    ...(title !== baseline.title ? { title } : {}),
    ...(content !== baseline.content && serializeContent(content) !== serializeContent(baseline.content) ? { content } : {}),
  };
}

function failureMessage(status: number) {
  if (status === 403) return "Your current repository permissions do not allow this action.";
  if (status === 404) return "The note is unavailable.";
  if (status === 413) return "This note exceeds the supported size.";
  return "Couldn’t complete the note action. Try again.";
}

async function readFailure(response: Response) {
  if (response.status === 400) {
    const result = await response.json().catch(() => null) as { message?: string } | null;
    if (result?.message) return result.message;
  }
  return failureMessage(response.status);
}

export function WorkspaceTeamNotesProvider({ repositoryId, children }: { repositoryId: string; children: ReactNode }) {
  const endpoint = "/api/repos/" + encodeURIComponent(repositoryId) + "/notes";
  const [data, setData] = useState<TeamNoteList | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<NoteEditor | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const operation = useRef<"load" | "mutate" | null>(null);
  const selected = data?.notes.find(({ id }) => id === selectedId) ?? null;
  const dirty = Boolean(editor && Object.keys(noteChanges(editor)).length);

  useEffect(() => {
    if (!dirty && !pending) return;
    function protect(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, pending]);

  const refresh = useCallback(async () => {
    if (operation.current) return;
    operation.current = "load";
    setLoading(true);
    setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) setData(null);
        setError(response.status === 404 ? "Team notes are unavailable." : failureMessage(response.status));
        return;
      }
      setData(await response.json() as TeamNoteList);
    } catch {
      setError("Couldn’t load team notes. Try again.");
    } finally {
      operation.current = null;
      setLoading(false);
    }
  }, [endpoint]);

  function replace(note: TeamNote) {
    setData((current) => current && { ...current, notes: [note, ...current.notes.filter(({ id }) => id !== note.id)] });
  }

  function canLeaveEditor() {
    if (operation.current === "mutate") return false;
    if (!dirty) return true;
    setError("Save or cancel your current note edits first.");
    return false;
  }

  function cancel() {
    if (operation.current === "mutate") return;
    setEditor(null);
    setError("");
    setStatus("");
  }

  function select(id: string) {
    if (selectedId === id || !canLeaveEditor()) return;
    cancel();
    setSelectedId(id);
  }

  function edit(note?: TeamNote) {
    if (!data || !canLeaveEditor()) return;
    setEditor({ note: note ?? null, fields: noteFields(note), conflict: null });
    setSelectedId(note?.id ?? null);
    setStatus("");
    setError("");
  }

  function change(fields: Partial<NoteFields>) {
    if (operation.current === "mutate") return;
    setEditor((current) => current && { ...current, fields: { ...current.fields, ...fields } });
  }

  function resolveConflict(keep: boolean) {
    if (!editor?.conflict || operation.current === "mutate") return;
    const note = editor.conflict.note;
    setEditor(keep ? { note, fields: { ...noteFields(note), ...noteChanges(editor) }, conflict: null } : null);
    setError("");
    setStatus(keep ? "Your edits are ready to save against the current version." : "The current saved note is loaded.");
  }

  async function mutate(method: "POST" | "PATCH" | "DELETE", note: TeamNote | null, input: CreateTeamNoteInput | UpdateTeamNoteInput | { version: number }) {
    if (operation.current) return;
    operation.current = "mutate";
    setPending(true);
    setStatus("");
    setError("");
    try {
      const response = await fetch(note ? endpoint + "/" + encodeURIComponent(note.id) : endpoint, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 409) {
        const conflict = await response.json() as TeamNoteConflict;
        replace(conflict.note);
        if (method === "DELETE") setError("The note changed. Review the saved version before confirming deletion again.");
        else setEditor((current) => current && { ...current, conflict });
      } else if (!response.ok) setError(await readFailure(response));
      else if (method === "DELETE" && note) {
        setData((current) => current && { ...current, notes: current.notes.filter(({ id }) => id !== note.id) });
        setSelectedId(null);
        setStatus("Note deleted");
      } else {
        const { note: saved } = await response.json() as { note: TeamNote };
        replace(saved);
        setSelectedId(saved.id);
        setEditor(null);
        setStatus(method === "POST" ? "Note created" : "Note saved");
      }
    } catch {
      setError(method === "DELETE" ? "Couldn’t delete the note. Try again." : "Couldn’t save the note. Your edits are still open.");
    } finally {
      operation.current = null;
      setPending(false);
    }
  }

  async function save() {
    if (!data || !editor || editor.conflict) return;
    const note = editor.note;
    if (!note) return mutate("POST", null, editor.fields);
    const changes = noteChanges(editor);
    if (Object.keys(changes).length) await mutate("PATCH", note, { version: note.version, changes });
  }

  return <NoteContext.Provider value={{
    data, selected, editor, loading, pending, dirty, error, status, refresh, select, edit, change, resolveConflict, cancel, save,
    remove: (note) => mutate("DELETE", note, { version: note.version }),
  }}>{children}</NoteContext.Provider>;
}
