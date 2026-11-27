"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type SavedDraft = { markdown: string; sourceRevision: string; version: number };
type ReadyResponse = { status: "ready"; source: string; sourceRevision: string; draft: SavedDraft | null };
type Conflict = { status: "conflict"; reason: "source" | "version"; currentRevision: string | null; draft: SavedDraft | null };
type Editing = {
  kind: "editing";
  markdown: string;
  baseline: string;
  sourceRevision: string;
  version: number;
  saving: boolean;
  conflict: Conflict | null;
  error: string | null;
};
type DraftEntry = Editing | { kind: "loading" } | { kind: "unavailable"; message: string };

type WorkspaceDrafts = {
  canEdit: boolean;
  entries: ReadonlyMap<string, DraftEntry>;
  begin: (path: string) => Promise<void>;
  change: (path: string, markdown: string) => void;
  save: (path: string) => Promise<void>;
  acceptVersion: (path: string) => void;
};

const maxMarkdownBytes = 256 * 1024;
const DraftContext = createContext<WorkspaceDrafts | null>(null);

export function useWorkspaceDrafts() {
  return useContext(DraftContext);
}

function fromSaved(draft: SavedDraft, conflict: Conflict | null = null): Editing {
  return {
    kind: "editing", markdown: draft.markdown, baseline: draft.markdown, sourceRevision: draft.sourceRevision,
    version: draft.version, saving: false, error: null, conflict,
  };
}

function unavailableMessage(status: number, action: "open" | "save") {
  if (status === 403) return "Editing drafts requires current repository write access.";
  if (status === 404) return "This document is unavailable.";
  return action === "open" ? "Couldn’t open the draft. Try again." : "Couldn’t save the draft. Try again.";
}

export function WorkspaceDraftProvider({ repositoryId, canEdit, children }: {
  repositoryId: string;
  canEdit: boolean;
  children: ReactNode;
}) {
  const entriesRef = useRef(new Map<string, DraftEntry>());
  const [entries, setEntries] = useState<ReadonlyMap<string, DraftEntry>>(entriesRef.current);
  const endpoint = "/api/repos/" + encodeURIComponent(repositoryId) + "/draft";
  const hasUnsaved = [...entries.values()].some((entry) =>
    entry.kind === "editing" && (entry.saving || entry.markdown !== entry.baseline));

  useEffect(() => {
    if (!hasUnsaved) return;
    function protect(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasUnsaved]);

  function set(path: string, entry: DraftEntry) {
    const next = new Map(entriesRef.current);
    next.set(path, entry);
    entriesRef.current = next;
    setEntries(next);
  }

  function updateEditing(path: string, update: (entry: Editing) => Editing) {
    const current = entriesRef.current.get(path);
    if (current?.kind === "editing") set(path, update(current));
  }

  async function begin(path: string) {
    const current = entriesRef.current.get(path);
    if (!canEdit || current?.kind === "loading" || current?.kind === "editing") return;
    set(path, { kind: "loading" });
    try {
      const response = await fetch(endpoint + "?path=" + encodeURIComponent(path), {
        cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 409) {
        const conflict = await response.json() as Conflict;
        if (conflict.draft) set(path, fromSaved(conflict.draft, conflict));
        else set(path, { kind: "unavailable", message: "The repository source changed. Open the current snapshot to start a draft." });
        return;
      }
      if (!response.ok) {
        set(path, { kind: "unavailable", message: unavailableMessage(response.status, "open") });
        return;
      }
      const { source, sourceRevision, draft } = await response.json() as ReadyResponse;
      set(path, fromSaved(draft ?? { markdown: source, sourceRevision, version: 0 }));
    } catch {
      set(path, { kind: "unavailable", message: unavailableMessage(0, "open") });
    }
  }

  function change(path: string, markdown: string) {
    if (!canEdit) return;
    updateEditing(path, (entry) => ({ ...entry, markdown }));
  }

  async function save(path: string) {
    const entry = entriesRef.current.get(path);
    if (!canEdit || entry?.kind !== "editing" || entry.saving || entry.conflict || entry.markdown === entry.baseline) return;
    const { markdown, sourceRevision, version } = entry;
    if (new TextEncoder().encode(markdown).byteLength > maxMarkdownBytes) {
      set(path, { ...entry, error: "Drafts can contain up to 256 KiB of Markdown." });
      return;
    }
    set(path, { ...entry, saving: true, error: null });
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ path, markdown, sourceRevision, version }),
      });
      if (response.status === 409) {
        const conflict = await response.json() as Conflict;
        updateEditing(path, (current) => ({ ...current, saving: false, conflict }));
      } else if (response.ok) {
        const { draft } = await response.json() as { status: "saved"; draft: SavedDraft };
        updateEditing(path, (current) => ({
          ...current, baseline: draft.markdown, sourceRevision: draft.sourceRevision, version: draft.version, saving: false,
        }));
      } else {
        updateEditing(path, (current) => ({ ...current, saving: false, error: unavailableMessage(response.status, "save") }));
      }
    } catch {
      updateEditing(path, (current) => ({ ...current, saving: false, error: unavailableMessage(0, "save") }));
    }
  }

  function acceptVersion(path: string) {
    if (!canEdit) return;
    const entry = entriesRef.current.get(path);
    if (entry?.kind !== "editing" || entry.conflict?.reason !== "version") return;
    const saved = entry.conflict.draft;
    if (!saved || entry.conflict.currentRevision !== entry.sourceRevision || saved.sourceRevision !== entry.sourceRevision) return;
    set(path, { ...entry, conflict: null, baseline: saved.markdown, version: saved.version });
  }

  return <DraftContext.Provider value={{ canEdit, entries, begin, change, save, acceptVersion }}>{children}</DraftContext.Provider>;
}
