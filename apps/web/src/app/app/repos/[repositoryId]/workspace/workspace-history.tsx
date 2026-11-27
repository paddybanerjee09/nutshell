"use client";

import type { FixtureProductHistory } from "@nutshell/server/fixture-history";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export const historyTabId = "view:history";

type HistoryResource = { state: "loading" | "unavailable" } | { state: "ready"; data: FixtureProductHistory };
type HistoryContextValue = { resource: HistoryResource | null; load: (force?: boolean) => Promise<void> };
const HistoryContext = createContext<HistoryContextValue | null>(null);

export function historyEndpoint(repositoryId: string) {
  return `/api/repos/${encodeURIComponent(repositoryId)}/history`;
}

export function useWorkspaceHistory() {
  const context = useContext(HistoryContext);
  const load = context?.load;
  useEffect(() => { void load?.(); }, [load]);
  return context;
}

export function WorkspaceHistoryProvider({ repositoryId, snapshotKey, children }: {
  repositoryId: string;
  snapshotKey: string;
  children: ReactNode;
}) {
  const endpoint = historyEndpoint(repositoryId);
  const [result, setResult] = useState<{ revision: string; value: HistoryResource } | null>(null);
  const request = useRef<{ revision: string; controller: AbortController } | null>(null);
  const storedRevision = useRef<string | null>(null);

  useEffect(() => () => {
    request.current?.controller.abort();
    request.current = null;
  }, []);

  const load = useCallback(async (force = false) => {
    if (request.current?.revision === snapshotKey || (!force && storedRevision.current === snapshotKey)) return;
    request.current?.controller.abort();
    const controller = new AbortController();
    request.current = { controller, revision: snapshotKey };
    setResult({ revision: snapshotKey, value: { state: "loading" } });
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      const data = response.ok ? await response.json() as FixtureProductHistory : null;
      if (controller.signal.aborted) return;
      if (data) storedRevision.current = snapshotKey;
      setResult({ revision: snapshotKey, value: data ? { state: "ready", data } : { state: "unavailable" } });
    } catch {
      if (!controller.signal.aborted) setResult({ revision: snapshotKey, value: { state: "unavailable" } });
    } finally {
      if (request.current?.controller === controller) request.current = null;
    }
  }, [endpoint, snapshotKey]);

  return <HistoryContext.Provider value={{ resource: result?.revision === snapshotKey ? result.value : null, load }}>
    {children}
  </HistoryContext.Provider>;
}

export function WorkspaceEntityHistoryLinks({ entityId, onOpen }: { entityId: string; onOpen: (changeId?: string) => void }) {
  const history = useWorkspaceHistory();
  const resource = history?.resource;
  const recent = resource?.state === "ready" ? resource.data.entries.filter((entry) => entry.change.entity_ids.includes(entityId)).slice(0, 4) : [];

  return <section className="workspace-entity-history" aria-label="Recent changes">
    <h2>Recent changes</h2>
    {recent.length > 0 && <ul>{recent.map(({ id, change }) => <li key={id}>
      <button type="button" className="workspace-wikilink" onClick={() => onOpen(id)}>{change.summary}</button>
    </li>)}</ul>}
    {resource?.state === "ready" && recent.length === 0 && <p>No indexed changes for this entity.</p>}
    <button type="button" className="workspace-wikilink" onClick={() => onOpen()}>View history</button>
  </section>;
}
