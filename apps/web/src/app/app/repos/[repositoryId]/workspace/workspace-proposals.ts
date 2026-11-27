"use client";

import type { FixtureDraftProposal as Proposal } from "@nutshell/server/fixture-draft-proposals";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type ProposalIssue = { path: string; code: string; message: string };
type Publication = "waiting" | "refreshing" | "superseded" | "invalid" | "paused" | "delivery-pending" | "unavailable";
type ProposalEntry = {
  proposal: Proposal | null;
  phase: "idle" | "loading" | "proposing" | "merging";
  publication: Publication | null;
  error: string | null;
  issues: ProposalIssue[];
  conflict: { currentRevision: string | null; draftVersion: number | null } | null;
};
type ProposalAction = { action: "propose"; version: number } | { action: "merge" };

const empty: ProposalEntry = { proposal: null, phase: "idle", publication: null, error: null, issues: [], conflict: null };
const conflictMessage = {
  source: "The repository source changed. Review its current revision before trying again.",
  version: "The saved draft version changed. Review your draft before trying again.",
  head: "The proposal changed. Review the current proposal revision before trying again.",
};

export function useWorkspaceProposals(repositoryId: string, canEdit: boolean) {
  const router = useRouter();
  const alive = useRef(true);
  const entriesRef = useRef(new Map<string, ProposalEntry>());
  const [entries, setEntries] = useState<ReadonlyMap<string, ProposalEntry>>(entriesRef.current);
  const baseUrl = "/api/repos/" + encodeURIComponent(repositoryId);
  const endpoint = baseUrl + "/draft-proposal";

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const update = useCallback((path: string, edit: Partial<ProposalEntry>) => {
    if (!alive.current) return;
    const next = new Map(entriesRef.current);
    next.set(path, { ...(next.get(path) ?? empty), ...edit });
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const watch = useCallback(async (path: string, proposal: Proposal, indexedRevision?: string) => {
    const expected = proposal.mergeRevision;
    if (!expected || expected === indexedRevision) return;
    update(path, { publication: "waiting" });
    function isCurrent() {
      const entry = entriesRef.current.get(path);
      return alive.current && entry?.publication === "waiting" && entry.proposal?.id === proposal.id &&
        entry.proposal.mergeRevision === expected;
    }
    const deadline = Date.now() + 20_000;
    while (isCurrent() && Date.now() < deadline) {
      try {
        const response = await fetch(baseUrl + "/snapshot", {
          cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(4_000, deadline - Date.now()))),
        });
        if (!isCurrent()) return;
        if (response.status === 404) {
          update(path, { publication: "unavailable" });
          return;
        }
        if (response.ok) {
          const snapshot = await response.json() as { revision: string | null; headRevision: string | null; status: string };
          if (!isCurrent()) return;
          if (snapshot.status === "current" && snapshot.revision === expected) {
            update(path, { publication: "refreshing" });
            router.refresh();
            return;
          }
          if (snapshot.headRevision && snapshot.headRevision !== expected) {
            update(path, { publication: "superseded" });
            router.refresh();
            return;
          }
          if (snapshot.status === "invalid") {
            update(path, { publication: "invalid" });
            return;
          }
        }
      } catch {
        // Short-lived read failures can recover before the polling deadline.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 900));
    }
    if (isCurrent()) update(path, { publication: "paused" });
  }, [baseUrl, router, update]);

  const load = useCallback(async (path: string, indexedRevision?: string) => {
    if (!canEdit || entriesRef.current.has(path)) return;
    update(path, { phase: "loading" });
    try {
      const response = await fetch(endpoint + "?path=" + encodeURIComponent(path), {
        cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 403 || response.status === 404) {
        update(path, { phase: "idle" });
        return;
      }
      if (!response.ok) throw new Error();
      const { proposal } = await response.json() as { status: "ready"; proposal: Proposal | null };
      update(path, { phase: "idle", proposal });
      if (proposal?.status === "merged") void watch(path, proposal, indexedRevision);
    } catch {
      update(path, { phase: "idle", error: "Couldn’t check the change proposal." });
    }
  }, [canEdit, endpoint, update, watch]);

  async function submit(path: string, action: ProposalAction, indexedRevision?: string) {
    const current = entriesRef.current.get(path) ?? empty;
    if (!canEdit || current.phase !== "idle" || (action.action === "merge" && !current.proposal)) return;
    const proposal = current.proposal;
    if (action.action === "merge" && proposal?.status === "merged" &&
      current.publication !== "delivery-pending" && current.publication !== "paused") return;
    const body = action.action === "propose"
      ? { ...action, path, expectedHead: proposal?.status === "open" ? proposal.headRevision : undefined }
      : { ...action, path, proposalId: proposal?.id, expectedHead: proposal?.headRevision };
    update(path, { phase: action.action === "propose" ? "proposing" : "merging", error: null, issues: [], conflict: null });
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000), body: JSON.stringify(body),
      });
      if (response.status === 409) {
        const result = await response.json() as {
          reason: keyof typeof conflictMessage;
          proposal: Proposal | null;
          currentRevision: string | null;
          draft: { version: number } | null;
        };
        update(path, {
          phase: "idle", proposal: result.proposal, publication: null, error: conflictMessage[result.reason],
          conflict: { currentRevision: result.currentRevision, draftVersion: result.draft?.version ?? null },
        });
        if (result.proposal?.status === "merged") void watch(path, result.proposal, indexedRevision);
      } else if (response.status === 422) {
        const { issues } = await response.json() as { issues: ProposalIssue[] };
        update(path, { phase: "idle", error: "The proposed change did not pass validation.", issues });
      } else if (response.status === 502) {
        const result = await response.json() as { proposal: Proposal };
        update(path, { phase: "idle", proposal: result.proposal, publication: "delivery-pending",
          error: "The simulated merge was saved. Retry sending it to indexing." });
      } else if (response.ok) {
        const result = await response.json() as { proposal: Proposal };
        update(path, { phase: "idle", proposal: result.proposal, publication: null });
        if (result.proposal.status === "merged") void watch(path, result.proposal, indexedRevision);
      } else {
        const error = response.status === 403 ? "Change proposals require current repository write access."
          : response.status === 404 ? "This change proposal is unavailable."
            : "Couldn’t complete the proposal action. Try again.";
        update(path, { phase: "idle", error });
      }
    } catch {
      update(path, { phase: "idle", error: "Couldn’t complete the proposal action. Try again." });
    }
  }

  return { entries, load, submit, refresh: () => router.refresh() };
}
