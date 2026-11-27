"use client";

import type { FixtureDraftProposal } from "@nutshell/server/fixture-draft-proposals";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useWorkspaceProposals } from "./workspace-proposals";

type SavedDraft = { markdown: string; sourceRevision: string; version: number };
type NewDraftInput = { path: string; title: string; sourceRevision: string };
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
  newPaths: readonly string[];
  newPathsReady: boolean;
  create: (input: NewDraftInput) => Promise<string | null>;
  begin: (path: string) => Promise<void>;
  change: (path: string, markdown: string) => void;
  save: (path: string) => Promise<void>;
  acceptVersion: (path: string) => void;
  proposals: ReturnType<typeof useWorkspaceProposals>;
  propose: (path: string, indexedRevision?: string) => Promise<void>;
  acceptPublication: (proposal: FixtureDraftProposal, source: string) => void;
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
  const [newPaths, setNewPaths] = useState<readonly string[]>([]);
  const [newPathsReady, setNewPathsReady] = useState(false);
  const endpoint = "/api/repos/" + encodeURIComponent(repositoryId) + "/draft";
  const proposals = useWorkspaceProposals(repositoryId, canEdit);
  const hasUnsaved = [...entries.values()].some((entry) =>
    entry.kind === "editing" && (entry.saving || entry.markdown !== entry.baseline));

  useEffect(() => {
    if (!canEdit) return;
    const request = new AbortController();
    async function loadNewPaths() {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(8_000)]),
        });
        if (response.ok && !request.signal.aborted) {
          const { drafts } = await response.json() as { drafts: { path: string }[] };
          setNewPaths(drafts.map(({ path }) => path));
        }
      } catch {
        // Published documents remain available if the private draft list cannot load.
      } finally {
        if (!request.signal.aborted) setNewPathsReady(true);
      }
    }
    void loadNewPaths();
    return () => request.abort();
  }, [canEdit, endpoint]);

  useEffect(() => {
    if (!hasUnsaved) return;
    function protect(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasUnsaved]);

  const set = useCallback((path: string, entry: DraftEntry) => {
    const next = new Map(entriesRef.current);
    next.set(path, entry);
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const acceptPublication = useCallback((proposal: FixtureDraftProposal, source: string) => {
    const current = entriesRef.current.get(proposal.path);
    if (proposal.status !== "merged" || !proposal.mergeRevision || current?.kind !== "editing" || current.saving ||
        current.sourceRevision !== proposal.baseRevision || current.version !== proposal.draftVersion ||
        current.markdown !== current.baseline || current.markdown !== source) return;
    set(proposal.path, fromSaved({ markdown: source, sourceRevision: proposal.mergeRevision, version: 0 }));
    setNewPaths((paths) => paths.includes(proposal.path) ? paths.filter((path) => path !== proposal.path) : paths);
  }, [set]);

  function updateEditing(path: string, update: (entry: Editing) => Editing) {
    const current = entriesRef.current.get(path);
    if (current?.kind === "editing") set(path, update(current));
  }

  const begin = useCallback(async (path: string) => {
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
  }, [canEdit, endpoint, set]);

  async function create(input: NewDraftInput) {
    if (!canEdit) return "Creating a draft requires current repository write access.";
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000), body: JSON.stringify(input),
      });
      if (response.status === 409) return "That path or the repository revision changed. Reopen the workspace before retrying.";
      if (response.status === 400) return "Enter a title and an unused .md path in the vault.";
      if (!response.ok) return unavailableMessage(response.status, "save");
      const { draft } = await response.json() as { status: "saved"; draft: SavedDraft };
      set(input.path, fromSaved(draft));
      setNewPaths((current) => current.includes(input.path) ? current : [...current, input.path]);
      return null;
    } catch {
      return "Couldn’t create the private draft. Try again.";
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

  async function propose(path: string, indexedRevision?: string) {
    const entry = entriesRef.current.get(path);
    if (!canEdit || entry?.kind !== "editing" || !entry.version || entry.saving || entry.conflict || entry.markdown !== entry.baseline) return;
    await proposals.submit(path, { action: "propose", version: entry.version }, indexedRevision);
  }

  return <DraftContext.Provider value={{
    canEdit, entries, newPaths: canEdit ? newPaths : [], newPathsReady: !canEdit || newPathsReady,
    create, begin, change, save, acceptVersion, proposals, propose, acceptPublication,
  }}>{children}</DraftContext.Provider>;
}
